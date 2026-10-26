import { appendFileSync, mkdirSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeArch(arch) {
  if (arch === "x64") return "x86_64";
  if (arch === "arm64") return "aarch64";
  throw new Error(`Unsupported architecture: ${arch}`);
}

function detectHostTriple() {
  const arch = normalizeArch(process.arch);
  const platform = process.platform;
  if (platform === "win32") return `${arch}-pc-windows-msvc`;
  if (platform === "darwin") return `${arch}-apple-darwin`;
  if (platform === "linux") return `${arch}-unknown-linux-gnu`;
  throw new Error(`Unsupported platform: ${platform}`);
}

export function parseVersion(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (!match) throw new Error(`Invalid SemVer: ${version}`);
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((v) => /^\d+$/.test(v) && v.length > 1 && v[0] === "0"))
    throw new Error("Invalid prerelease number");
  return { core: match.slice(1, 4).map(BigInt), pre };
}
export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  for (let i = 0; i < 3; i++)
    if (left.core[i] !== right.core[i])
      return left.core[i] > right.core[i] ? 1 : -1;
  if (!left.pre.length || !right.pre.length)
    return Number(!left.pre.length) - Number(!right.pre.length);
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    if (left.pre[i] === undefined) return -1;
    if (right.pre[i] === undefined) return 1;
    const x = left.pre[i],
      y = right.pre[i];
    if (x === y) continue;
    const nx = /^\d+$/.test(x),
      ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}
export function safeUrl(value) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw new Error(
      "Release URLs require HTTPS (HTTP only on loopback for tests)",
    );
  return url;
}
export function safeOutput(value) {
  if (typeof value !== "string" || /[\r\n\0]/.test(value))
    throw new Error("Invalid multiline output");
  return value;
}
export function safeBinaryPath(value) {
  safeOutput(value);
  if (
    !value ||
    value.includes("\\") ||
    value
      .split("/")
      .some(
        (v) =>
          !v ||
          v === "." ||
          v === ".." ||
          !/^[-A-Za-z0-9_.]+$/.test(v) ||
          /[.]$/.test(v) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(v),
      )
  )
    throw new Error("Unsafe binary path");
  return value;
}

// Retry only explicitly transient read responses, within one total timeout.
// A long Retry-After is returned to the caller rather than retried prematurely.
export async function fetchReleaseResponse(url, timeoutMs) {
  safeUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { signal, headers: { "user-agent": "fidan-actions/setup" } });
    safeUrl(response.url);
    if (![429, 503].includes(response.status) || attempt === 2) return response;
    const retry = response.headers.get("retry-after");
    const wait = retry === null ? 500 * 2 ** attempt
      : /^\d+$/.test(retry) ? Number(retry) * 1000
      : Date.parse(retry) - Date.now();
    if (!Number.isFinite(wait) || wait > 5000) return response;
    await response.body?.cancel();
    await delay(Math.max(0, wait), undefined, { signal });
  }
}

async function fetchJson(url) {
  safeUrl(url);
  const response = await fetchReleaseResponse(url, 30_000);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("Manifest exceeds 8 MiB limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function resolveVersionEntry(manifest, requestedVersion, hostTriple) {
  const versions = Array.isArray(manifest.fidan_versions)
    ? manifest.fidan_versions
    : [];
  const matches = versions.filter((entry) => entry.host_triple === hostTriple);
  if (matches.length === 0) {
    throw new Error(
      `Manifest does not contain a Fidan release for host triple ${hostTriple}`,
    );
  }
  if (requestedVersion === "latest") {
    const stable = matches.filter(
      (entry) => !parseVersion(entry.version).pre.length,
    );
    if (!stable.length) throw new Error("No stable release available");
    return stable.sort((a, b) => compareVersions(b.version, a.version))[0];
  }
  const exact = matches.find((entry) => entry.version === requestedVersion);
  if (!exact) {
    throw new Error(
      `Manifest does not contain Fidan version ${requestedVersion} for host triple ${hostTriple}`,
    );
  }
  return exact;
}

function writeOutput(name, value) {
  const outputPath = getRequiredEnv("GITHUB_OUTPUT");
  appendFileSync(outputPath, `${name}=${safeOutput(value)}\n`, "utf8");
}

async function main() {
  const requestedVersion = process.env.INPUT_VERSION?.trim() || "latest";
  const manifestUrl = getRequiredEnv("INPUT_MANIFEST_URL");
  const requestedInstallDir =
    process.env.INPUT_INSTALL_DIR?.trim() || path.join(tmpdir(), "fidan");
  const installDir = path.resolve(requestedInstallDir);
  safeOutput(installDir);
  const hostTriple = detectHostTriple();
  const manifest = await fetchJson(manifestUrl);
  const entry = resolveVersionEntry(manifest, requestedVersion, hostTriple);
  if (!entry.url || !entry.binary_relpath || !entry.sha256 || !entry.version) {
    throw new Error("Resolved manifest entry is missing required fields");
  }
  parseVersion(entry.version);
  safeUrl(entry.url);
  safeBinaryPath(entry.binary_relpath);
  if (!/^[a-fA-F0-9]{64}$/.test(entry.sha256))
    throw new Error("Invalid SHA-256");
  mkdirSync(installDir, { recursive: true });
  writeOutput(
    "cache-key",
    createHash("sha256")
      .update(
        `${manifestUrl}\n${hostTriple}\n${entry.version}\n${entry.sha256.toLowerCase()}`,
      )
      .digest("hex"),
  );
  writeOutput("install-dir", installDir);
  writeOutput("host-triple", hostTriple);
  writeOutput("version-resolved", entry.version);
  writeOutput("archive-url", entry.url);
  writeOutput("archive-sha256", entry.sha256);
  writeOutput("binary-relpath", entry.binary_relpath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
