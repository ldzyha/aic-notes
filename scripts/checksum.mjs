import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const fileName = `aic-notes-${manifest.version}.vsix`;
const bytes = await readFile(path.join(root, fileName));
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(
  path.join(root, `${fileName}.sha256`),
  `${sha256}  ${fileName}\n`,
  "utf8",
);
process.stdout.write(`${sha256}  ${fileName}\n`);
