import { appendFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeArch(arch) {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'arm64') return 'aarch64';
  throw new Error(`Unsupported architecture: ${arch}`);
}

function detectHostTriple() {
  const arch = normalizeArch(process.arch);
  const platform = process.platform;
  if (platform === 'win32') return `${arch}-pc-windows-msvc`;
  if (platform === 'darwin') return `${arch}-apple-darwin`;
  if (platform === 'linux') return `${arch}-unknown-linux-gnu`;
  throw new Error(`Unsupported platform: ${platform}`);
}

function parseVersionTuple(version) {
  return version
    .split('.')
    .map((part) => {
      const match = /^\d+/.exec(part);
      return match ? Number.parseInt(match[0], 10) : 0;
    });
}

function isPrerelease(version) {
  return /[-+]/.test(version);
}

function compareVersionEntriesDesc(a, b) {
  const pa = parseVersionTuple(a);
  const pb = parseVersionTuple(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }

  const aPrerelease = isPrerelease(a);
  const bPrerelease = isPrerelease(b);
  if (aPrerelease !== bPrerelease) {
    return aPrerelease ? 1 : -1;
  }

  return b.localeCompare(a);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'fidan-actions/setup'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest from ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function resolveVersionEntry(manifest, requestedVersion, hostTriple) {
  const versions = Array.isArray(manifest.fidan_versions) ? manifest.fidan_versions : [];
  const matches = versions.filter((entry) => entry.host_triple === hostTriple);
  if (matches.length === 0) {
    throw new Error(`Manifest does not contain a Fidan release for host triple ${hostTriple}`);
  }
  if (requestedVersion === 'latest') {
    return [...matches].sort((a, b) => compareVersionEntriesDesc(a.version, b.version))[0];
  }
  const exact = matches.find((entry) => entry.version === requestedVersion);
  if (!exact) {
    throw new Error(`Manifest does not contain Fidan version ${requestedVersion} for host triple ${hostTriple}`);
  }
  return exact;
}

function writeOutput(name, value) {
  const outputPath = getRequiredEnv('GITHUB_OUTPUT');
  appendFileSync(outputPath, `${name}=${value}\n`, 'utf8');
}

async function main() {
  const requestedVersion = process.env.INPUT_VERSION?.trim() || 'latest';
  const manifestUrl = getRequiredEnv('INPUT_MANIFEST_URL');
  const requestedInstallDir = process.env.INPUT_INSTALL_DIR?.trim() || path.join(tmpdir(), 'fidan');
  const installDir = path.resolve(requestedInstallDir);
  mkdirSync(installDir, { recursive: true });
  const hostTriple = detectHostTriple();
  const manifest = await fetchJson(manifestUrl);
  const entry = resolveVersionEntry(manifest, requestedVersion, hostTriple);
  if (!entry.url || !entry.binary_relpath || !entry.sha256 || !entry.version) {
    throw new Error('Resolved manifest entry is missing required fields');
  }
  writeOutput('install-dir', installDir);
  writeOutput('host-triple', hostTriple);
  writeOutput('version-resolved', entry.version);
  writeOutput('archive-url', entry.url);
  writeOutput('archive-sha256', entry.sha256);
  writeOutput('binary-relpath', entry.binary_relpath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
