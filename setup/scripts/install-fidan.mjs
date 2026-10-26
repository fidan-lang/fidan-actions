// Only the expected regular executable is materialized; tar paths are never extracted.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { hostname } from "node:os";
import { pathToFileURL } from "node:url";
import { safeBinaryPath, safeOutput, safeUrl, fetchReleaseResponse } from "./resolve-fidan.mjs";
const MAX_DOWNLOAD = 128 * 1024 * 1024;
const MAX_EXPANDED = 512 * 1024 * 1024;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function executableFromArchive(compressed, relative) {
  safeBinaryPath(relative);
  const tar = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED });
  let offset = 0,
    candidate = null,
    count = 0,
    ended = false;
  const paths = new Set();
  const text = (buffer) =>
    new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(
        0,
        buffer.indexOf(0) < 0 ? buffer.length : buffer.indexOf(0),
      ),
    );
  const octal = (buffer) => {
    const value = text(buffer).trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar numeric field");
    return parseInt(value, 8);
  };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((v) => v === 0)) {
      if (
        tar.length - offset < 1024 ||
        tar.length % 512 !== 0 ||
        !tar.subarray(offset).every((v) => v === 0)
      )
        throw new Error("Invalid tar end");
      ended = true;
      break;
    }
    if (++count > 10000) throw new Error("Too many archive entries");
    const checksum = header.reduce(
      (sum, v, i) => sum + (i >= 148 && i < 156 ? 32 : v),
      0,
    );
    if (checksum !== octal(header.subarray(148, 156)))
      throw new Error("Invalid tar header checksum");
    let name = text(header.subarray(0, 100));
    if (text(header.subarray(257, 263)) === "ustar") {
      const prefix = text(header.subarray(345, 500));
      if (prefix) name = `${prefix}/${name}`;
    }
    while (name.startsWith("./")) name = name.slice(2);
    name = name.replace(/\/$/, "");
    const type = header[156];
    if (type !== 0 && type !== 48 && type !== 53)
      throw new Error(
        "Unsupported tar entry (links and special metadata forbidden)",
      );
    const size = octal(header.subarray(124, 136));
    if (
      (type === 53 && size !== 0) ||
      size > MAX_EXPANDED ||
      offset + 512 + Math.ceil(size / 512) * 512 > tar.length
    )
      throw new Error("Truncated or oversized tar entry");
    if (name) {
      safeBinaryPath(name);
      if (paths.has(name.toLowerCase()))
        throw new Error("Duplicate archive path");
      paths.add(name.toLowerCase());
      if (
        type !== 53 &&
        (name === relative ||
          (name.includes("/") &&
            name.slice(name.indexOf("/") + 1) === relative))
      ) {
        if (candidate) throw new Error("Ambiguous executable paths");
        candidate = Buffer.from(
          tar.subarray(offset + 512, offset + 512 + size),
        );
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!ended) throw new Error("Missing tar end");
  if (!candidate?.length) throw new Error("Expected executable missing");
  return candidate;
}
function noSymlinkAncestors(filename) {
  for (let at = path.resolve(filename); ; at = path.dirname(at)) {
    try {
      if (fs.lstatSync(at).isSymbolicLink())
        throw new Error("Symbolic install path forbidden");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (at === path.dirname(at)) break;
  }
}
const METADATA = ".fidan-install.json";
const ARCHIVE = ".fidan-release.tar.gz";
const LOCK = ".fidan-install.lock";
const MAX_METADATA = 16 * 1024;

function regularFile(filename, limit) {
  noSymlinkAncestors(filename);
  let stat;
  try {
    stat = fs.lstatSync(filename);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.size > limit)
    throw new Error("Invalid or oversized installation file");
  return stat;
}
function readJson(filename) {
  if (!regularFile(filename, MAX_METADATA))
    throw new Error("Installation metadata missing");
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}
function destinations(root, relative) {
  if ([METADATA, ARCHIVE, LOCK].includes(relative.split("/")[0].toLowerCase()))
    throw new Error("Executable path collides with installer state");
  // Publish the executable last. A persistent guard covers every intermediate state.
  return [
    path.join(root, ARCHIVE),
    path.join(root, METADATA),
    path.join(root, relative),
  ];
}
function rollback(root, lock, relative) {
  const journalPath = path.join(lock, "journal.json");
  if (!regularFile(journalPath, MAX_METADATA)) return;
  const journal = readJson(journalPath);
  if (
    journal.relative !== relative ||
    !Array.isArray(journal.previous) ||
    journal.previous.length !== 3 ||
    journal.previous.some((value) => typeof value !== "boolean")
  )
    throw new Error("Invalid installation recovery journal; backup retained");
  const files = destinations(root, relative);
  for (let index = files.length - 1; index >= 0; index--) {
    const backup = path.join(lock, `old-${index}`);
    regularFile(files[index], MAX_EXPANDED);
    if (regularFile(backup, MAX_EXPANDED)) {
      fs.rmSync(files[index], { force: true });
      fs.renameSync(backup, files[index]);
    } else if (!journal.previous[index]) {
      fs.rmSync(files[index], { force: true });
    } else if (!regularFile(files[index], MAX_EXPANDED)) {
      throw new Error(
        "Previous installation file missing; recovery journal retained",
      );
    }
  }
}
function claimInstallation(root, relative) {
  const lock = path.join(root, LOCK);
  noSymlinkAncestors(lock);
  if (fs.existsSync(lock)) {
    const owner = readJson(path.join(lock, "owner.json"));
    if (
      owner.host !== hostname() ||
      owner.relative !== relative ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid <= 0
    )
      throw new Error(
        "Unknown installation owner; inspect retained recovery state",
      );
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") alive = false;
      else throw error;
    }
    if (alive)
      throw new Error("Installation is busy; do not remove its recovery state");
    if (!regularFile(path.join(lock, "committed"), 0))
      rollback(root, lock, relative);
    fs.rmSync(lock, { recursive: true });
  }
  // mkdir is the inter-process exclusion point. Concurrent owners fail closed.
  fs.mkdirSync(lock);
  try {
    fs.writeFileSync(
      path.join(lock, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        host: hostname(),
        relative,
      }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    fs.rmSync(lock, { recursive: true });
    throw error;
  }
  return lock;
}

export async function install(env = process.env) {
  const relative = safeBinaryPath(env.FIDAN_BINARY_RELPATH);
  const url = safeUrl(env.FIDAN_URL);
  if (!/^[a-fA-F0-9]{64}$/.test(env.FIDAN_SHA256 ?? ""))
    throw new Error("Invalid SHA-256");
  const checksum = env.FIDAN_SHA256.toLowerCase();
  const root = path.resolve(safeOutput(env.FIDAN_INSTALL_DIR));
  const files = destinations(root, relative);
  noSymlinkAncestors(path.join(root, relative));
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  const lock = claimInstallation(root, relative);
  let committed = false;
  try {
    const response = await fetchReleaseResponse(url, 120_000);
    safeUrl(response.url);
    if (!response.ok)
      throw new Error(`Release download failed: HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_DOWNLOAD) throw new Error("Download limit exceeded");
      chunks.push(chunk);
    }
    const compressed = Buffer.concat(chunks);
    if (sha(compressed) !== checksum) throw new Error("Checksum mismatch");
    const binary = executableFromArchive(compressed, relative);
    const metadata = Buffer.from(
      JSON.stringify({ archive: checksum, binary: sha(binary), relative }),
    );
    const previous = files.map((file) =>
      Boolean(regularFile(file, MAX_EXPANDED)),
    );
    for (const [index, bytes] of [compressed, metadata, binary].entries())
      fs.writeFileSync(path.join(lock, `new-${index}`), bytes, {
        flag: "wx",
        mode: index === 2 ? 0o755 : 0o600,
      });
    // An incomplete journal cannot authorize rollback of untouched live files.
    fs.writeFileSync(
      path.join(lock, "journal.partial"),
      JSON.stringify({ relative, previous }),
      { flag: "wx", mode: 0o600 },
    );
    fs.renameSync(
      path.join(lock, "journal.partial"),
      path.join(lock, "journal.json"),
    );
    for (const [index, file] of files.entries()) {
      if (previous[index]) fs.renameSync(file, path.join(lock, `old-${index}`));
      fs.renameSync(path.join(lock, `new-${index}`), file);
    }
    fs.writeFileSync(path.join(lock, "committed"), "", {
      flag: "wx",
      mode: 0o600,
    });
    committed = true;
  } catch (error) {
    try {
      rollback(root, lock, relative);
    } catch (recoveryError) {
      // Retain backups and guard, never execute or claim a valid mixed installation.
      throw new AggregateError(
        [error, recoveryError],
        "Installation failed; recovery state retained in " + lock,
      );
    }
    fs.rmSync(lock, { recursive: true });
    throw error;
  }
  if (committed) {
    // Failure to clean a committed journal must not turn successful publication into
    // a reported failed transaction. The independent verifier still checks all bytes.
    try {
      fs.rmSync(lock, { recursive: true });
    } catch {
      console.warn(
        "Installation committed; recovery directory cleanup is pending.",
      );
    }
  }
}
export function verifyInstalled(root, relative, checksum) {
  safeBinaryPath(relative);
  safeOutput(root);
  if (!/^[a-fA-F0-9]{64}$/.test(checksum ?? ""))
    throw new Error("Invalid SHA-256");
  destinations(root, relative);
  const lock = path.join(root, LOCK);
  noSymlinkAncestors(lock);
  if (fs.existsSync(lock) && !regularFile(path.join(lock, "committed"), 0))
    throw new Error(
      "Interrupted or active installation; run the installer to recover",
    );
  const metadata = readJson(path.join(root, METADATA));
  const archive = path.join(root, ARCHIVE);
  if (!regularFile(archive, MAX_DOWNLOAD))
    throw new Error("Verified release archive missing; reinstall required");
  const compressed = fs.readFileSync(archive);
  if (sha(compressed) !== checksum.toLowerCase())
    throw new Error("Cached archive checksum mismatch");
  const expected = executableFromArchive(compressed, relative);
  const executable = path.join(root, relative);
  const executableStat = regularFile(executable, MAX_EXPANDED);
  if (
    !executableStat ||
    (process.platform !== "win32" && !(executableStat.mode & 0o111)) ||
    metadata.relative !== relative ||
    metadata.archive !== checksum.toLowerCase() ||
    sha(expected) !== metadata.binary ||
    !expected.equals(fs.readFileSync(executable))
  )
    throw new Error("Cached installation integrity mismatch");
  return executable;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  install().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
