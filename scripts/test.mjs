import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// Do not rely on shell glob expansion (PowerShell/cmd and POSIX differ on Node 20).
const files = (await readdir(new URL("../test/", import.meta.url)))
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => `test/${name}`);
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...files],
  {
    cwd: new URL("../", import.meta.url),
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
