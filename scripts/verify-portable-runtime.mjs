import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRepository = "https://github.com/ldzyha/standard-notes-aic";
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const safeName = (name) =>
  typeof name === "string" &&
  !name.includes("\\") &&
  name
    .split("/")
    .every(
      (part) => /^[a-z\d_.-]+$/iu.test(part) && part !== "." && part !== "..",
    );

export function validatePortableSnapshot(snapshot, { release = false } = {}) {
  if (
    !object(snapshot) ||
    snapshot.format !== "aic-portable-runtime" ||
    snapshot.version !== 1 ||
    snapshot.sourceRepository !== sourceRepository ||
    typeof snapshot.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/u.test(snapshot.sourceCommit) ||
    (snapshot.sourceState !== undefined &&
      snapshot.sourceState !== "working-tree") ||
    !object(snapshot.hashes)
  )
    throw new Error("Invalid portable runtime snapshot metadata");
  if (release && snapshot.sourceState === "working-tree")
    throw new Error(
      "Commit canonical portable source and regenerate its build snapshot before publishing a release",
    );
  const names = Object.keys(snapshot.hashes);
  const sorted = [...names].sort();
  if (
    !names.length ||
    names.length > 10000 ||
    names.some(
      (name, index) =>
        !safeName(name) ||
        name !== sorted[index] ||
        typeof snapshot.hashes[name] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(snapshot.hashes[name]),
    )
  )
    throw new Error("Invalid portable runtime snapshot file inventory");
  return names;
}

export function verifyPortableContent(snapshot, files, options) {
  const names = validatePortableSnapshot(snapshot, options);
  const actual = [...files.keys()].sort();
  if (
    actual.length !== names.length ||
    actual.some((name, index) => name !== names[index])
  )
    throw new Error("Portable runtime file inventory differs from snapshot");
  for (const name of names)
    if (sha256(files.get(name)) !== snapshot.hashes[name])
      throw new Error(`Portable runtime snapshot hash mismatch: ${name}`);
  const html = files.get("index.html")?.toString("utf8");
  if (
    !html ||
    !/<script\b[^>]*type="module"[^>]*src="\.\/assets\/[^"<>]+\.js"/u.test(html)
  )
    throw new Error("Portable runtime is missing its local module entry");
  for (const match of html.matchAll(
    /<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gu,
  )) {
    const reference = match[1] ?? match[2] ?? match[3];
    if (
      !reference.startsWith("./") ||
      !safeName(reference.slice(2)) ||
      !files.has(reference.slice(2))
    )
      throw new Error("Portable HTML references missing or remote resources");
  }
  return {
    status: "ok",
    sourceRepository,
    sourceCommit: snapshot.sourceCommit,
    ...(snapshot.sourceState ? { sourceState: snapshot.sourceState } : {}),
    files: names.length,
  };
}

export async function verifyPortableSnapshot(
  root,
  {
    directory = path.join(root, "vendor", "portable-runtime"),
    release = false,
  } = {},
) {
  const snapshotPath = path.join(root, "PORTABLE_SNAPSHOT.json");
  const snapshotStat = await lstat(snapshotPath);
  if (!snapshotStat.isFile())
    throw new Error("Portable runtime snapshot must be a regular file");
  if (snapshotStat.size > 1024 * 1024)
    throw new Error("Portable runtime snapshot exceeds size limit");
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const names = validatePortableSnapshot(snapshot, { release });
  const files = new Map();
  const directories = new Set();
  let totalBytes = 0;
  async function visit(location, prefix = "") {
    if (!(await lstat(location)).isDirectory())
      throw new Error("Portable runtime directories must not be symlinks");
    for (const entry of await readdir(location, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeName(name)) throw new Error("Unsafe portable runtime path");
      const file = path.join(location, entry.name);
      if (entry.isDirectory()) {
        directories.add(name);
        await visit(file, name);
      } else if (entry.isFile()) {
        totalBytes += (await lstat(file)).size;
        if (totalBytes > 256 * 1024 * 1024 || files.size >= 10000)
          throw new Error("Portable runtime file exceeds size limit");
        files.set(name, await readFile(file));
      } else
        throw new Error(
          "Portable runtime must contain only regular files and directories",
        );
    }
  }
  await visit(directory);
  const expectedDirectories = new Set();
  for (const name of names) {
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++)
      expectedDirectories.add(parts.slice(0, index).join("/"));
  }
  if (
    JSON.stringify([...directories].sort()) !==
    JSON.stringify([...expectedDirectories].sort())
  )
    throw new Error(
      "Portable runtime directory inventory differs from snapshot",
    );
  return verifyPortableContent(snapshot, files, { release });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  verifyPortableSnapshot(root, { release: process.argv.includes("--release") })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
