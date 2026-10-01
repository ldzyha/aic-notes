import test from "node:test";
import assert from "node:assert/strict";
import * as nodePath from "node:path";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import * as path from "../src/notes/uri-path.js";
import { utf8Length, randomHex, sha256 } from "../src/host-runtime.js";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/notes/resources.js", import.meta.url)),
  ],
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["vscode"],
  write: false,
  logLevel: "silent",
});
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: (name) => {
    assert.equal(name, "vscode");
    return {};
  },
});
const {
  workspaceFolderFor,
  isFileResource,
  resourceReadOnly,
  assertWritableResource,
} = module.exports;
const root = {
  scheme: "vscode-vfs",
  authority: "github",
  path: "/owner/repo",
  query: "ref=main",
};
const folder = { uri: root };
const api = {
  workspace: {
    getWorkspaceFolder: () => folder,
    fs: { isWritableFileSystem: () => true },
  },
};

test("virtual resources preserve workspace URI authority, boundary and revision", () => {
  assert.equal(
    workspaceFolderFor({ ...root, path: `${root.path}/docs/a.md` }, api),
    folder,
  );
  for (const patch of [
    { authority: "another" },
    { scheme: "https" },
    { scheme: "untitled" },
    { path: "/owner/repository/a.md" },
    { path: "/owner/repo/../secret.md" },
    { query: "ref=other" },
    { fragment: "revision" },
  ])
    assert.equal(workspaceFolderFor({ ...root, ...patch }, api), undefined);
  assert.equal(
    isFileResource({ scheme: "file", path: "/standalone.note.md" }, api),
    true,
  );
});

test("unknown and read-only virtual providers cannot mutate notes", () => {
  for (const writable of [false, undefined]) {
    const readonlyApi = {
      workspace: { fs: { isWritableFileSystem: () => writable } },
    };
    assert.equal(resourceReadOnly(root, readonlyApi), true);
    assert.throws(
      () => assertWritableResource(root, readonlyApi),
      /read-only/u,
    );
  }
  assert.equal(resourceReadOnly(root, api), false);
  assert.equal(resourceReadOnly({ scheme: "untitled" }, api), false);
});

test("URI path functions match POSIX operations for supported document paths", () => {
  for (const value of [
    "",
    ".",
    "..",
    "/",
    "a/",
    "a/b.md",
    "a/./b.md",
    "a/../b.md",
    "../a",
    "../../a",
    "/a/../b",
    "/a//b/",
    "a\\b.md",
    ".env",
    "c:/project/src/file.ts",
  ]) {
    for (const operation of ["normalize", "basename", "dirname", "isAbsolute"])
      assert.equal(
        path[operation](value),
        nodePath.posix[operation](value),
        `${operation} ${value}`,
      );
  }
});

test("Web platform encoders and crypto preserve Unicode byte limits and SHA256", async () => {
  assert.equal(utf8Length("note"), 4);
  assert.equal(utf8Length("ї🙂"), 6);
  assert.equal(
    await sha256("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.match(randomHex(24), /^[a-f0-9]{48}$/u);
  assert.notEqual(randomHex(24), randomHex(24));
});
