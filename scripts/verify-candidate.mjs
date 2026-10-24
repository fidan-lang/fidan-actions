import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function readCandidate(file) {
  const contract = JSON.parse(readFileSync(file, "utf8"));
  if (contract.compiler_repository !== "fidan-lang/fidan" ||
      !/^[a-f0-9]{40}$/.test(contract.compiler_sha ?? "") ||
      !/^[a-f0-9]{40}$/.test(contract.setup_sha ?? "") ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(contract.compiler_version ?? "")) {
    throw new Error("Candidate contract requires the official repository, exact full SHAs and compiler version");
  }
  return contract;
}

export function verifyCheckout(directory, expected) {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error("Checked-out candidate does not match the approved immutable SHA");
  }
  const changes = spawnSync("git", ["-C", directory, "status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" });
  if (changes.error || changes.status !== 0 || changes.stdout.trim()) {
    throw new Error("Candidate checkout contains modified tracked source");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, setup, compiler] = process.argv.slice(2);
  const contract = readCandidate(file);
  verifyCheckout(setup, contract.setup_sha);
  const selected = process.env.REQUESTED_COMPILER_SHA || contract.compiler_sha;
  if (!/^[a-f0-9]{40}$/.test(selected)) throw new Error("Compiler override must be an exact lowercase 40-character SHA");
  if (compiler) verifyCheckout(compiler, selected);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `compiler_sha=${selected}\ncompiler_version=${contract.compiler_version}\n`);
  }
  console.log(`Verified candidate contract: compiler ${selected}; setup ${contract.setup_sha}`);
}
