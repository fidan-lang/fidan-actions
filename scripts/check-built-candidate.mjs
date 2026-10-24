// Run the existing installer adversarial suite with the actual source-built
// executable as its required artifact fixture. No released binary or PATH lookup.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv[2]) throw new Error("Explicit source-built compiler binary required");
const binary = realpathSync(process.argv[2]);
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: "utf8", windowsHide: true, ...options});
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error || result.stderr || result.status}`);
  return result;
}
const version = run(binary, ["--version"]).stdout.trim();
if (!/^fidan [0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(version)) throw new Error("Unexpected candidate version response");
mkdirSync(path.join(root, "target"), {recursive: true});
const scratch = mkdtempSync(path.join(root, "target", "built-candidate-"));
const archive = path.join(scratch, "candidate.tar.gz");
run("tar", ["-czf", archive, "-C", path.dirname(binary), path.basename(binary)]);
run(process.execPath, ["--test", path.join(root, "setup/test/setup.test.mjs")], {
  stdio: "inherit", timeout: 180000,
  env: {...process.env, FIDAN_CANDIDATE_ARCHIVE: archive, FIDAN_CANDIDATE_VERSION: version.slice(6)},
});
