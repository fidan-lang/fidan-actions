import { readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function isCommit(value) {
  return typeof value === "string" && value.length === 40 && /^[a-f0-9]{40}$/.test(value);
}

export function readCandidate(file) {
  const contract = JSON.parse(readFileSync(file, "utf8"));
  if (contract.compiler_repository !== "fidan-lang/fidan" ||
      !isCommit(contract.compiler_sha) ||
      !isCommit(contract.setup_sha) ||
      /[\r\n\0]/.test(contract.compiler_version ?? "") ||
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(contract.compiler_version ?? "")) {
    throw new Error("Candidate contract requires the official repository, exact full SHAs and compiler version");
  }
  if (contract.args_repository !== undefined || contract.args_sha !== undefined) {
    if (contract.args_repository !== "fidan-lang/args" || !isCommit(contract.args_sha))
      throw new Error("Args requires the official repository and an exact immutable SHA");
  }
  return contract;
}

export function verifyCheckout(directory, expected) {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (result.error || result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error("Checked-out candidate does not match the approved immutable SHA");
  }
  const changes = spawnSync("git", ["-C", directory, "status", "--porcelain", "--untracked-files=all"], { encoding: "utf8" });
  if (changes.error || changes.status !== 0 || changes.stdout.trim()) {
    throw new Error("Candidate checkout contains modified or untracked source");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, setup, compiler, args] = process.argv.slice(2);
  const contract = readCandidate(file);
  verifyCheckout(setup, contract.setup_sha);
  const selected = process.env.REQUESTED_COMPILER_SHA || contract.compiler_sha;
  if (!isCommit(selected)) throw new Error("Compiler override must be an exact lowercase 40-character SHA");
  if (compiler) verifyCheckout(compiler, selected);
  if (args) {
    if (!contract.args_sha) throw new Error("Args checkout requires an exact candidate contract");
    verifyCheckout(args, contract.args_sha);
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT,
      `compiler_sha=${selected}\ncompiler_version=${contract.compiler_version}\n`);
  }
  if (process.env.GITHUB_OUTPUT && contract.args_sha) {
    appendFileSync(process.env.GITHUB_OUTPUT, `args_repository=${contract.args_repository}\nargs_sha=${contract.args_sha}\n`);
  }
  console.log(`Verified candidate contract: compiler ${selected}; setup ${contract.setup_sha}`);
}
