import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyCoreSnapshot } from "../scripts/verify-core.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aic-core-integrity-"));
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("aic-core-integrity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vendor = path.join(root, "vendor", "aic-editor-core");
  await mkdir(vendor, { recursive: true });
  const content = {
    "module.css": ".module { color: inherit; }\n",
    "module.d.ts": "export declare const value: number;\n",
    "module.js": "export const value = 1;\n",
  };
  const snapshot = {
    coreVersion: "3.4.0",
    sourceRepository: "https://github.com/ldzyha/standard-notes-aic",
    sourceCommit: "a".repeat(40),
    files: Object.fromEntries(
      Object.entries(content).map(([name, text]) => [name, hash(text)]),
    ),
  };
  const saveSnapshot = () =>
    writeFile(path.join(root, "CORE_SNAPSHOT.json"), JSON.stringify(snapshot));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ aicEditorCore: "3.4.0" }),
  );
  await saveSnapshot();
  for (const [name, text] of Object.entries(content))
    await writeFile(path.join(vendor, name), text);
  return { root, vendor, snapshot, saveSnapshot };
}

test("shared core snapshot verifies all files without a sibling checkout", async (t) => {
  const { root, snapshot } = await fixture(t);
  assert.deepEqual(await verifyCoreSnapshot(root), {
    status: "ok",
    coreVersion: "3.4.0",
    sourceRepository: snapshot.sourceRepository,
    sourceCommit: snapshot.sourceCommit,
    files: 3,
  });
});

test("shared core snapshot rejects a tampered module", async (t) => {
  const { root, vendor } = await fixture(t);
  await writeFile(path.join(vendor, "module.js"), "export const value = 2;\n");
  await assert.rejects(verifyCoreSnapshot(root), /hash mismatch: module\.js/u);
});

test("shared core snapshot rejects a missing declaration", async (t) => {
  const { root, vendor } = await fixture(t);
  await rm(path.join(vendor, "module.d.ts"));
  await assert.rejects(verifyCoreSnapshot(root), /file inventory differs/u);
});

test("shared core snapshot rejects unexpected vendor files and directories", async (t) => {
  for (const name of ["extra.js", "README.md", "nested"]) {
    await t.test(name, async (t) => {
      const { root, vendor } = await fixture(t);
      if (name === "nested") await mkdir(path.join(vendor, name));
      else await writeFile(path.join(vendor, name), "untracked");
      await assert.rejects(verifyCoreSnapshot(root), /file inventory differs/u);
    });
  }
});

test("shared core snapshot rejects mismatched package core version", async (t) => {
  const { root } = await fixture(t);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ aicEditorCore: "3.3.0" }),
  );
  await assert.rejects(verifyCoreSnapshot(root), /versions differ/u);
});

test("shared core snapshot requires immutable canonical source metadata", async (t) => {
  for (const [field, value] of [
    ["coreVersion", "3.4"],
    ["coreVersion", 3.4],
    ["sourceRepository", "https://github.com/other/standard-notes-aic"],
    ["sourceCommit", "main"],
    ["sourceCommit", "g".repeat(40)],
    ["files", []],
  ]) {
    await t.test(`${field}: ${JSON.stringify(value)}`, async (t) => {
      const { root, snapshot, saveSnapshot } = await fixture(t);
      snapshot[field] = value;
      await saveSnapshot();
      await assert.rejects(verifyCoreSnapshot(root), /Invalid.*metadata/u);
    });
  }
});

test("shared core snapshot rejects unsafe paths, invalid hashes and unsorted inventories", async (t) => {
  for (const files of [
    {},
    { "../module.js": "a".repeat(64) },
    { "module.js": "not-a-sha256" },
    { "module.js": "a".repeat(64), "module.css": "b".repeat(64) },
  ]) {
    await t.test(JSON.stringify(files), async (t) => {
      const { root, snapshot, saveSnapshot } = await fixture(t);
      snapshot.files = files;
      await saveSnapshot();
      await assert.rejects(
        verifyCoreSnapshot(root),
        /Invalid.*file inventory/u,
      );
    });
  }
});
