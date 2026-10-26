import fs from "node:fs";
import path from "node:path";
import { verifyInstalled } from "./install-fidan.mjs";
import { safeOutput } from "./resolve-fidan.mjs";
const env = process.env;
const binary = verifyInstalled(
  env.FIDAN_INSTALL_DIR,
  env.FIDAN_BINARY_RELPATH,
  env.FIDAN_SHA256,
);
fs.appendFileSync(env.GITHUB_PATH, `${safeOutput(path.dirname(binary))}\n`);
for (const [key, value] of Object.entries({
  "fidan-bin": binary,
  "install-dir": env.FIDAN_INSTALL_DIR,
  "version-resolved": env.FIDAN_VERSION,
  "host-triple": env.FIDAN_HOST,
  "cache-hit": env.CACHE_HIT || "false",
}))
  fs.appendFileSync(env.GITHUB_OUTPUT, `${key}=${safeOutput(value)}\n`);
