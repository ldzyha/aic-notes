import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRepository = "https://github.com/ldzyha/standard-notes-aic";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Verify a self-contained distribution without requiring a sibling checkout. */
export async function verifyCoreSnapshot(root) {
  const directory = path.resolve(root);
  const manifest = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const snapshot = JSON.parse(
    await readFile(path.join(directory, "CORE_SNAPSHOT.json"), "utf8"),
  );
  if (
    !object(snapshot) ||
    typeof snapshot.coreVersion !== "string" ||
    !/^\d+\.\d+\.\d+$/u.test(snapshot.coreVersion) ||
    snapshot.sourceRepository !== sourceRepository ||
    typeof snapshot.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(snapshot.sourceCommit) ||
    (snapshot.sourceState !== undefined &&
      snapshot.sourceState !== "working-tree") ||
    !object(snapshot.files)
  )
    throw new Error("Invalid shared core snapshot metadata");
  if (!object(manifest) || manifest.aicEditorCore !== snapshot.coreVersion)
    throw new Error("Package and shared core snapshot versions differ");

  const files = Object.keys(snapshot.files);
  const sortedFiles = [...files].sort();
  if (
    files.length === 0 ||
    files.some(
      (name) =>
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:js|css|d\.ts)$/u.test(name) ||
        typeof snapshot.files[name] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(snapshot.files[name]),
    ) ||
    files.some((name, index) => name !== sortedFiles[index])
  )
    throw new Error("Invalid shared core snapshot file inventory");

  const vendor = path.join(directory, "vendor", "aic-editor-core");
  const entries = await readdir(vendor, { withFileTypes: true });
  const actual = entries.map((entry) => entry.name).sort();
  if (
    entries.some((entry) => !entry.isFile()) ||
    actual.length !== files.length ||
    actual.some((name, index) => name !== files[index])
  )
    throw new Error("Shared core vendor file inventory differs from snapshot");

  for (const name of files) {
    const content = await readFile(path.join(vendor, name));
    const hash = createHash("sha256").update(content).digest("hex");
    if (hash !== snapshot.files[name])
      throw new Error(`Shared core snapshot hash mismatch: ${name}`);
  }
  return {
    status: "ok",
    coreVersion: snapshot.coreVersion,
    sourceRepository: snapshot.sourceRepository,
    sourceCommit: snapshot.sourceCommit,
    ...(snapshot.sourceState ? { sourceState: snapshot.sourceState } : {}),
    files: files.length,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    process.stdout.write(`${JSON.stringify(await verifyCoreSnapshot(root))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
