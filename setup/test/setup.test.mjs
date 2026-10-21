import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
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

async function releaseFixture(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fidan-action-security-"));
  const bytes = tar([["fidan", "NEW"]]);
  const server = createServer((_, res) => res.end(bytes));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    FIDAN_BINARY_RELPATH: "fidan",
    FIDAN_INSTALL_DIR: root,
    FIDAN_URL: `http://127.0.0.1:${server.address().port}/release`,
    FIDAN_SHA256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    await check(root, env);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("cache cannot self-attest when both executable and adjacent binary digest are tampered", async () => {
  await releaseFixture(async (root, env) => {
    await install(env);
    fs.writeFileSync(path.join(root, "fidan"), "MALICIOUS_FIXTURE");
    const meta = path.join(root, ".fidan-install.json");
    const value = JSON.parse(fs.readFileSync(meta, "utf8"));
    value.binary = createHash("sha256")
      .update("MALICIOUS_FIXTURE")
      .digest("hex");
    fs.writeFileSync(meta, JSON.stringify(value));
    assert.throws(
      () => verifyInstalled(root, "fidan", env.FIDAN_SHA256),
      "the manifest archive checksum must authenticate the actual cached executable",
    );
  });
});

test("metadata destination failure leaves existing executable bytes and mode intact", async () => {
  await releaseFixture(async (root, env) => {
    const output = path.join(root, "fidan");
    fs.writeFileSync(output, "OLD", { mode: 0o755 });
    const oldMode = fs.statSync(output).mode;
    fs.mkdirSync(path.join(root, ".fidan-install.json"));
    await assert.rejects(install(env));
    assert.equal(fs.readFileSync(output, "utf8"), "OLD");
    assert.equal(fs.statSync(output).mode, oldMode);
    assert(fs.statSync(path.join(root, ".fidan-install.json")).isDirectory());
  });
});

function previousInstall(root) {
  const bytes = tar([["fidan", "OLD"]]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const metadata = JSON.stringify({
    relative: "fidan",
    archive: digest,
    binary: createHash("sha256").update("OLD").digest("hex"),
  });
  fs.writeFileSync(path.join(root, "fidan"), "OLD", { mode: 0o750 });
  fs.writeFileSync(path.join(root, ".fidan-install.json"), metadata, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(root, ".fidan-release.tar.gz"), bytes, {
    mode: 0o600,
  });
  return digest;
}

test("each rename failure rolls back the entire previous verified installation", async () => {
  for (let boundary = 1; boundary <= 7; boundary++) {
    await releaseFixture(async (root, env) => {
      const old = previousInstall(root);
      const mode = fs.statSync(path.join(root, "fidan")).mode;
      const rename = fs.renameSync;
      let calls = 0,
        injected = false;
      fs.renameSync = function (...args) {
        if (++calls === boundary) {
          injected = true;
          throw Object.assign(new Error("fixture rename denied"), {
            code: "EPERM",
          });
        }
        return rename.apply(this, args);
      };
      try {
        await assert.rejects(install(env));
      } finally {
        fs.renameSync = rename;
      }
      assert(injected, `rename boundary ${boundary} must be reached`);
      assert.equal(
        verifyInstalled(root, "fidan", old),
        path.join(root, "fidan"),
      );
      assert.equal(fs.statSync(path.join(root, "fidan")).mode, mode);
      assert(!fs.existsSync(path.join(root, ".fidan-install.lock")));
    });
  }
});

test("partial journal write never publishes or blocks the previous installation", async () => {
  await releaseFixture(async (root, env) => {
    const old = previousInstall(root);
    const write = fs.writeFileSync;
    let injected = false;
    fs.writeFileSync = function (file, ...args) {
      if (String(file).includes("journal") && !injected) {
        injected = true;
        write.call(this, file, "{", ...args.slice(1));
        throw Object.assign(new Error("fixture full disk"), { code: "ENOSPC" });
      }
      return write.call(this, file, ...args);
    };
    try {
      await assert.rejects(install(env));
    } finally {
      fs.writeFileSync = write;
    }
    assert(injected);
    assert.equal(verifyInstalled(root, "fidan", old), path.join(root, "fidan"));
    assert(!fs.existsSync(path.join(root, ".fidan-install.lock")));
  });
});

test("process death during publication is guarded and recovers before a failed download", async () => {
  await releaseFixture(async (root, env) => {
    const old = previousInstall(root);
    const module = new URL("../scripts/install-fidan.mjs", import.meta.url)
      .href;
    const code = `import fs from "node:fs";import path from "node:path";import {install} from ${JSON.stringify(module)};
      const rename=fs.renameSync;fs.renameSync=function(from,to){rename(from,to);
      if(path.resolve(to)===path.join(process.env.FIDAN_INSTALL_DIR,"fidan"))process.exit(86);};
      await install();`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [status] = await once(child, "exit");
      assert.equal(status, 86);
    } finally {
      clearTimeout(timer);
      child.kill();
    }
    assert.throws(
      () => verifyInstalled(root, "fidan", env.FIDAN_SHA256),
      /installation/i,
    );
    // A deliberate checksum failure on the next attempt must still restore OLD first.
    await assert.rejects(
      install({ ...env, FIDAN_SHA256: "0".repeat(64) }),
      /Checksum/,
    );
    assert.equal(verifyInstalled(root, "fidan", old), path.join(root, "fidan"));
    assert(!fs.existsSync(path.join(root, ".fidan-install.lock")));
  });
});

test("concurrent installations fail closed rather than sharing a transaction", async () => {
  await releaseFixture(async (root, env) => {
    previousInstall(root);
    const outcomes = await Promise.allSettled([install(env), install(env)]);
    assert.equal(
      outcomes.filter((item) => item.status === "fulfilled").length,
      1,
    );
    const failure = outcomes.find((item) => item.status === "rejected");
    assert.match(failure.reason.message, /busy/i);
    assert.equal(
      verifyInstalled(root, "fidan", env.FIDAN_SHA256),
      path.join(root, "fidan"),
    );
  });
});

test("cache archive, metadata, manifest changes and missing binaries cannot pass verification", async () => {
  await releaseFixture(async (root, env) => {
    await install(env);
    assert.throws(
      () => verifyInstalled(root, "fidan", "0".repeat(64)),
      /checksum/i,
    );
    const archive = path.join(root, ".fidan-release.tar.gz");
    const bytes = fs.readFileSync(archive);
    bytes[0] ^= 1;
    fs.writeFileSync(archive, bytes);
    assert.throws(
      () => verifyInstalled(root, "fidan", env.FIDAN_SHA256),
      /checksum/i,
    );
    await install(env);
    fs.writeFileSync(path.join(root, ".fidan-install.json"), "{");
    assert.throws(() => verifyInstalled(root, "fidan", env.FIDAN_SHA256));
    await install(env);
    fs.unlinkSync(path.join(root, "fidan"));
    assert.throws(() => verifyInstalled(root, "fidan", env.FIDAN_SHA256));
  });
});

test("metadata links never overwrite unrelated files", async (t) => {
  await releaseFixture(async (root, env) => {
    fs.writeFileSync(path.join(root, "fidan"), "OLD");
    const unrelated = path.join(root, "unrelated.json");
    fs.writeFileSync(unrelated, "PRESERVE");
    try {
      fs.symlinkSync(unrelated, path.join(root, ".fidan-install.json"));
    } catch (error) {
      if (error.code === "EPERM") {
        t.skip("host does not allow creating file symlinks");
        return;
      }
      throw error;
    }
    await assert.rejects(install(env), /Symbolic/);
    assert.equal(fs.readFileSync(unrelated, "utf8"), "PRESERVE");
    assert.equal(fs.readFileSync(path.join(root, "fidan"), "utf8"), "OLD");
  });
});

test("staging and commit-marker write failures restore the previous verified pair", async () => {
  for (const suffix of ["owner.json", "new-0", "new-1", "new-2", "committed"]) {
    await releaseFixture(async (root, env) => {
      const old = previousInstall(root);
      const write = fs.writeFileSync;
      let injected = false;
      fs.writeFileSync = function (file, ...args) {
        if (!injected && path.basename(String(file)) === suffix) {
          injected = true;
          throw Object.assign(new Error("fixture full disk"), {
            code: "ENOSPC",
          });
        }
        return write.call(this, file, ...args);
      };
      try {
        await assert.rejects(install(env));
      } finally {
        fs.writeFileSync = write;
      }
      assert(injected, `write boundary ${suffix} must be reached`);
      assert.equal(
        verifyInstalled(root, "fidan", old),
        path.join(root, "fidan"),
      );
      assert(!fs.existsSync(path.join(root, ".fidan-install.lock")));
    });
  }
});

test(
  "Unix cache verification requires an executable mode",
  {
    skip:
      process.platform === "win32"
        ? "Unix permission semantics require Unix runner"
        : false,
  },
  async () => {
    await releaseFixture(async (root, env) => {
      await install(env);
      fs.chmodSync(path.join(root, "fidan"), 0o600);
      assert.throws(
        () => verifyInstalled(root, "fidan", env.FIDAN_SHA256),
        /integrity/,
      );
    });
  },
);

test("distribution uses unmodified Apache 2.0 and retains NOTICE", () => {
  assert.equal(
    createHash("sha256").update(fs.readFileSync(new URL("../../LICENSE", import.meta.url))).digest("hex"),
    "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
  );
  assert.match(fs.readFileSync(new URL("../../NOTICE", import.meta.url), "utf8"), /Copyright/);
});
