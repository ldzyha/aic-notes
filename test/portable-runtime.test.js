import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "yaml";
import {
  verifyPortableContent,
  verifyPortableSnapshot,
} from "../scripts/verify-portable-runtime.mjs";

const files = () =>
  new Map([
    ["assets/entry.js", Buffer.from("export const fixture = 1;\n")],
    [
      "index.html",
      Buffer.from('<script type="module" src="./assets/entry.js"></script>'),
    ],
  ]);
const metadata = (entries = files()) => ({
  format: "aic-portable-runtime",
  version: 1,
  sourceRepository: "https://github.com/ldzyha/standard-notes-aic",
  sourceCommit: "a".repeat(40),
  hashes: Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, data]) => [
        name,
        createHash("sha256").update(data).digest("hex"),
      ]),
  ),
});

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "aic-portable-verify-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "vendor/portable-runtime");
  await mkdir(path.join(directory, "assets"), { recursive: true });
  const entries = files();
  for (const [name, data] of entries)
    await writeFile(path.join(directory, name), data);
  const snapshotPath = path.join(root, "PORTABLE_SNAPSHOT.json");
  const snapshot = metadata(entries);
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  return { root, directory, snapshotPath, snapshot, entries };
}

test("portable runtime verifies independently of a sibling source checkout", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await verifyPortableSnapshot(f.root), {
    status: "ok",
    sourceRepository: f.snapshot.sourceRepository,
    sourceCommit: f.snapshot.sourceCommit,
    files: 2,
  });
  const before = await readFile(f.snapshotPath);
  await verifyPortableSnapshot(f.root, { release: true });
  assert.deepEqual(await readFile(f.snapshotPath), before);
});

test("working-tree provenance supports local builds and rejects release proof", async (t) => {
  const f = await fixture(t);
  f.snapshot.sourceState = "working-tree";
  await writeFile(f.snapshotPath, JSON.stringify(f.snapshot));
  assert.equal(
    (await verifyPortableSnapshot(f.root)).sourceState,
    "working-tree",
  );
  await assert.rejects(
    verifyPortableSnapshot(f.root, { release: true }),
    /Commit canonical portable source/u,
  );
});

test("portable runtime rejects changed, missing, extra files and unsafe inventory", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "assets/entry.js"), "changed fixture");
  await assert.rejects(verifyPortableSnapshot(f.root), /hash mismatch/u);
  await writeFile(
    path.join(f.directory, "assets/entry.js"),
    f.entries.get("assets/entry.js"),
  );
  await mkdir(path.join(f.directory, "unrelated-empty"));
  await assert.rejects(verifyPortableSnapshot(f.root), /directory inventory/u);
  await rm(path.join(f.directory, "unrelated-empty"), { recursive: true });
  await writeFile(path.join(f.directory, "extra.txt"), "unrelated fixture");
  await assert.rejects(verifyPortableSnapshot(f.root), /file inventory/u);
  for (const hashPath of [
    "../outside.js",
    "/absolute.js",
    "assets\\entry.js",
    "assets/../entry.js",
  ])
    assert.throws(
      () =>
        verifyPortableContent(
          { ...metadata(), hashes: { [hashPath]: "a".repeat(64) } },
          files(),
        ),
      /inventory/u,
    );
  const missing = files();
  missing.delete("assets/entry.js");
  assert.throws(() => verifyPortableContent(metadata(), missing), /inventory/u);
});

test("portable runtime rejects symlinks, remote or missing HTML resources and malformed provenance", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.directory, "assets/entry.js"));
  await symlink(f.snapshotPath, path.join(f.directory, "assets/entry.js"));
  await assert.rejects(verifyPortableSnapshot(f.root), /regular files/u);
  for (const extra of [
    '<script src="https://example.invalid/remote.js"></script>',
    "<script src = 'https://example.invalid/remote.js'></script>",
    "<script src=https://example.invalid/remote.js></script>",
    '<link href="./assets/missing.css" rel="stylesheet">',
  ]) {
    const entries = files();
    entries.set(
      "index.html",
      Buffer.from(entries.get("index.html").toString() + extra),
    );
    assert.throws(
      () => verifyPortableContent(metadata(entries), entries),
      /missing or remote/u,
    );
  }
  for (const override of [
    { format: "other" },
    { version: 2 },
    { sourceRepository: "https://example.invalid" },
    { sourceCommit: "invalid" },
    { sourceState: "committed" },
  ])
    assert.throws(
      () => verifyPortableContent({ ...metadata(), ...override }, files()),
      /metadata/u,
    );
});

test("VS Code build and release use the snapshot-owned portable runtime", async () => {
  const root = new URL("../", import.meta.url);
  const build = await readFile(new URL("esbuild.mjs", root), "utf8");
  const release = await readFile(
    new URL("scripts/verify-release.mjs", root),
    "utf8",
  );
  assert.match(build, /vendor\/portable-runtime/u);
  assert.match(build, /await verifyPortableSnapshot/u);
  assert.doesNotMatch(build, /\.\.\/standard-notes-aic\/dist-pwa/u);
  assert.match(release, /verifyPortableSnapshot\(root, \{ release: true \}\)/u);
  assert.match(release, /extension\/PORTABLE_SNAPSHOT\.json/u);
  assert.match(release, /extension\/dist\/portable\/index\.html/u);
  assert.match(release, /verifyPortableContent/u);
  const workflow = parse(
    await readFile(new URL(".github/workflows/release.yml", root), "utf8"),
  );
  for (const name of ["test-platforms", "verify-universal"]) {
    const steps = workflow.jobs[name].steps;
    const check = steps.findIndex(
      (step) => step.run === "npm run portable:check",
    );
    const build = steps.findIndex((step) =>
      /npm run (?:build|package)/u.test(step.run),
    );
    assert.ok(check >= 0 && check < build);
  }
});

test("Git checkout with autocrlf preserves portable build bytes and verifies its snapshot", async (t) => {
  const f = await fixture(t);
  f.entries.set(
    "EXTENSION_UPDATES.md",
    Buffer.from("# Synthetic release updates\n\nKeep exact build bytes.\n"),
  );
  f.entries.set(
    "assets/opaque.bin",
    Buffer.from([0x89, 0x00, 0x0d, 0x0a, 0x0a, 0xff]),
  );
  for (const [name, bytes] of f.entries)
    await writeFile(path.join(f.directory, name), bytes);
  const snapshotBytes = Buffer.from(
    JSON.stringify(metadata(f.entries), null, 2) + "\n",
  );
  await writeFile(f.snapshotPath, snapshotBytes);
  const attributes = await readFile(
    new URL("../.gitattributes", import.meta.url),
  );
  await writeFile(path.join(f.root, ".gitattributes"), attributes);
  await writeFile(
    path.join(f.root, "conversion-control.txt"),
    "Synthetic control\nSecond line\n",
  );
  const git = (cwd, ...args) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  git(f.root, "init", "--quiet");
  git(f.root, "config", "user.name", "Synthetic checkout test");
  git(f.root, "config", "user.email", "synthetic@example.invalid");
  git(f.root, "config", "core.autocrlf", "false");
  git(
    f.root,
    "add",
    "--",
    ".gitattributes",
    "PORTABLE_SNAPSHOT.json",
    "vendor/portable-runtime",
    "conversion-control.txt",
  );
  git(
    f.root,
    "-c",
    "core.hooksPath=" + path.join(f.root, "empty-hooks"),
    "-c",
    "commit.gpgSign=false",
    "commit",
    "--quiet",
    "-m",
    "Synthetic portable snapshot",
  );
  const checkout = path.join(f.root, "autocrlf-checkout");
  git(f.root, "clone", "--quiet", "--no-checkout", f.root, checkout);
  git(checkout, "config", "core.autocrlf", "true");
  git(checkout, "checkout", "--force", "HEAD");
  assert.equal(
    await readFile(path.join(checkout, "conversion-control.txt"), "utf8"),
    "Synthetic control\r\nSecond line\r\n",
  );
  for (const [name, bytes] of f.entries)
    assert.deepEqual(
      await readFile(path.join(checkout, "vendor/portable-runtime", name)),
      bytes,
    );
  assert.deepEqual(
    await readFile(path.join(checkout, "PORTABLE_SNAPSHOT.json")),
    snapshotBytes,
  );
  assert.equal(
    (await verifyPortableSnapshot(checkout, { release: true })).files,
    f.entries.size,
  );
});
