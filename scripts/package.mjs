import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error("Invalid R.F.B release version");
const archive = `aic-notes-${version}.vsix`;
const install = process.argv.includes("--install");
const result = install
  ? spawnSync(process.platform === "win32" ? "code.cmd" : "code", ["--install-extension", archive, "--force"], {
    cwd: root, stdio: "inherit", shell: process.platform === "win32",
  })
  : spawnSync(process.execPath, ["node_modules/@vscode/vsce/vsce", "package", "--no-dependencies", "--out", archive], {
    cwd: root, stdio: "inherit",
  });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
