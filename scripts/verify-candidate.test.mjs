import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readCandidate, verifyCheckout } from "./verify-candidate.mjs";
import path from "node:path";

const target = new URL("../target/", import.meta.url);
mkdirSync(target, { recursive: true });
test("candidate metadata rejects mutable, injected and foreign refs", () => {
  const root = mkdtempSync(new URL("contract-", target));
  const file = path.join(root, "candidate.json");
  const valid = {compiler_repository: "fidan-lang/fidan", compiler_sha: "a".repeat(40), setup_sha: "b".repeat(40), compiler_version: "1.0.16"};
  try {
    writeFileSync(file, JSON.stringify(valid));
    assert.deepEqual(readCandidate(file), valid);
    for (const value of ["latest", "main", "v1.0.16", "abc", "a".repeat(40) + "\n", "a".repeat(40) + "\nFORGED=1", '"; throw "INJECTED']) {
      for (const field of ["compiler_sha", "setup_sha"]) {
        writeFileSync(file, JSON.stringify({...valid, [field]: value}));
        assert.throws(() => readCandidate(file));
      }
    }
    writeFileSync(file, JSON.stringify({...valid, compiler_repository: "someone/fidan"}));
    assert.throws(() => readCandidate(file));
  } finally { rmSync(root, { recursive: true }); }
});

test("source checkout must match the exact clean Git commit", () => {
  const root = mkdtempSync(new URL("source-", target));
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, ...args], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git("init");
    writeFileSync(path.join(root, "source"), "approved");
    git("add", "source");
    git("-c", "user.name=Candidate Test", "-c", "user.email=candidate@example.invalid", "commit", "-m", "fixture");
    const sha = git("rev-parse", "HEAD");
    verifyCheckout(root, sha);
    assert.throws(() => verifyCheckout(root, "0".repeat(40)));
    writeFileSync(path.join(root, "source"), "substituted");
    assert.throws(() => verifyCheckout(root, sha));
  } finally { rmSync(root, {recursive: true, force: true}); }
});
