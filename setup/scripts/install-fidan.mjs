// Only the expected regular executable is materialized; tar paths are never extracted.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { safeBinaryPath, safeOutput, safeUrl } from "./resolve-fidan.mjs";
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
export async function install(env = process.env) {
  const relative = safeBinaryPath(env.FIDAN_BINARY_RELPATH);
  const url = safeUrl(env.FIDAN_URL);
  if (!/^[a-fA-F0-9]{64}$/.test(env.FIDAN_SHA256 ?? ""))
    throw new Error("Invalid SHA-256");
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
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
  if (sha(compressed) !== env.FIDAN_SHA256.toLowerCase())
    throw new Error("Checksum mismatch");
  const binary = executableFromArchive(compressed, relative);
  const root = path.resolve(safeOutput(env.FIDAN_INSTALL_DIR));
  const output = path.join(root, relative);
  noSymlinkAncestors(output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const scratch = fs.mkdtempSync(
    path.join(path.dirname(output), ".fidan-install-"),
  );
  const temp = path.join(scratch, "binary");
  try {
    fs.writeFileSync(temp, binary, { flag: "wx", mode: 0o755 });
    fs.renameSync(temp, output);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  fs.writeFileSync(
    path.join(root, ".fidan-install.json"),
    JSON.stringify({
      archive: env.FIDAN_SHA256.toLowerCase(),
      binary: sha(binary),
      relative,
    }),
  );
}
export function verifyInstalled(root, relative, checksum) {
  safeBinaryPath(relative);
  safeOutput(root);
  noSymlinkAncestors(path.join(root, relative));
  const metadata = JSON.parse(
    fs.readFileSync(path.join(root, ".fidan-install.json"), "utf8"),
  );
  if (
    metadata.relative !== relative ||
    metadata.archive !== checksum.toLowerCase() ||
    sha(fs.readFileSync(path.join(root, relative))) !== metadata.binary
  )
    throw new Error("Cached installation integrity mismatch");
  return path.join(root, relative);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  install().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
