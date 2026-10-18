import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareVersions,
  resolveVersionEntry,
  safeBinaryPath,
  safeOutput,
  safeUrl,
} from "../scripts/resolve-fidan.mjs";
import {
  executableFromArchive,
  install,
  verifyInstalled,
} from "../scripts/install-fidan.mjs";
function tar(entries) {
  const chunks = [];
  for (const [name, body, type = "0"] of entries) {
    const h = Buffer.alloc(512);
    h.write(name);
    h.write("0000755", 100);
    h.write(body.length.toString(8).padStart(11, "0"), 124);
    h.fill(32, 148, 156);
    h[156] = type.charCodeAt(0);
    h.write(
      h
        .reduce((a, v) => a + v, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    chunks.push(
      h,
      Buffer.from(body),
      Buffer.alloc((512 - (body.length % 512)) % 512),
    );
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
test("SemVer stable ordering, build metadata, explicit prereleases and invalid input", () => {
  assert(compareVersions("1.0.10", "1.0.9") > 0);
  assert(compareVersions("1.0.0-rc.10", "1.0.0-rc.2") > 0);
  assert.equal(compareVersions("1.0.0+a", "1.0.0+b"), 0);
  assert(compareVersions("1.0.0", "1.0.0-rc.99") > 0);
  const manifest = {
    fidan_versions: ["1.0.9", "1.0.16", "2.0.0-rc.1"].map((version) => ({
      version,
      host_triple: "host",
    })),
  };
  assert.equal(
    resolveVersionEntry(manifest, "latest", "host").version,
    "1.0.16",
  );
  assert.equal(
    resolveVersionEntry(manifest, "2.0.0-rc.1", "host").version,
    "2.0.0-rc.1",
  );
  assert.throws(() => compareVersions("v1.2.3", "1.2.3"));
  assert.throws(() => compareVersions("1.0.0-01", "1.0.0"));
  assert.throws(() => resolveVersionEntry(manifest, "latest", "missing"));
});
test("output, paths and URL boundaries cannot inject shell or workflow output", () => {
  for (const value of [
    "../fidan",
    "/tmp/fidan",
    "C:/fidan",
    "bin\\fidan",
    "a/../fidan",
    "a\nfidan",
    "bin/CON",
    "bin/fidan.",
  ])
    assert.throws(() => safeBinaryPath(value));
  assert.throws(() => safeOutput("x\narchive-url=bad"));
  assert.throws(() => safeUrl("http://example.com/a"));
  assert.throws(() => safeUrl("https://user:pass@example.com"));
  assert.equal(safeBinaryPath("bin/fidan.exe"), "bin/fidan.exe");
  assert(safeUrl("http://127.0.0.1/a"));
});
test("tar selection rejects traversal, links, duplicates, bad checksum and ambiguous roots", () => {
  assert.equal(
    executableFromArchive(
      tar([["release/fidan", "binary"]]),
      "fidan",
    ).toString(),
    "binary",
  );
  for (const entries of [
    [
      ["../escape", "x"],
      ["fidan", "ok"],
    ],
    [["fidan", "target", "2"]],
    [
      ["fidan", "x"],
      ["fidan", "y"],
    ],
    [
      ["a/fidan", "x"],
      ["b/fidan", "y"],
    ],
  ])
    assert.throws(() => executableFromArchive(tar(entries), "fidan"));
  const raw = gunzipSync(tar([["fidan", "binary"]]));
  assert.throws(
    () => executableFromArchive(gzipSync(raw.subarray(0, 1024)), "fidan"),
    /tar end/,
  );
  assert.throws(
    () => executableFromArchive(gzipSync(raw.subarray(0, 1540)), "fidan"),
    /tar end/,
  );
  const damaged = tar([["fidan", "binary"]]);
  damaged[damaged.length - 5] ^= 1;
  assert.throws(() => executableFromArchive(damaged, "fidan"));
});
test("download failure/tamper preserve existing install, valid install verifies and cache tamper fails", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidan-action-test-"));
  const bytes = tar([["fidan", "new executable"]]);
  const server = createServer((_, res) => res.end(bytes));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    FIDAN_BINARY_RELPATH: "fidan",
    FIDAN_INSTALL_DIR: root,
    FIDAN_URL: `http://127.0.0.1:${server.address().port}/release`,
    FIDAN_SHA256: "0".repeat(64),
  };
  try {
    fs.writeFileSync(path.join(root, "fidan"), "original");
    await assert.rejects(install(env), /Checksum/);
    assert.equal(fs.readFileSync(path.join(root, "fidan"), "utf8"), "original");
    env.FIDAN_SHA256 = createHash("sha256").update(bytes).digest("hex");
    await install(env);
    assert.equal(
      verifyInstalled(root, "fidan", env.FIDAN_SHA256),
      path.join(root, "fidan"),
    );
    fs.writeFileSync(path.join(root, "fidan"), "tampered");
    assert.throws(() => verifyInstalled(root, "fidan", env.FIDAN_SHA256));
    await new Promise((resolve) => server.close(resolve));
    await assert.rejects(install(env));
  } finally {
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
