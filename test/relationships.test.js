import test from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";

// Bundle the real filesystem adapter with the VS Code API mocked at its
// boundary. No extension host, filesystem writes, or test-only production API
// is needed, and the tests also run on the release pipeline's Node 20.
const apiKey = Symbol.for("aic-notes.relationships-test-vscode");
let activeWorkspace;
const FileType = { File: 1, Directory: 2 };
function uri(value) {
  const normalized = path.posix.normalize(value);
  return {
    scheme: "file",
    path: normalized,
    fsPath: normalized,
    toString: () => `file://${normalized}`,
  };
}
globalThis[apiKey] = {
  FileType,
  Uri: {
    joinPath: (base, ...parts) => uri(path.posix.join(base.path, ...parts)),
  },
  RelativePattern: class {
    constructor(base, pattern) {
      this.base = base;
      this.pattern = pattern;
    }
  },
  workspace: {
    getWorkspaceFolder: (...args) =>
      activeWorkspace.getWorkspaceFolder(...args),
    asRelativePath: (...args) => activeWorkspace.asRelativePath(...args),
    findFiles: (...args) => activeWorkspace.findFiles(...args),
    fs: {
      stat: (...args) => activeWorkspace.stat(...args),
      readDirectory: (...args) => activeWorkspace.readDirectory(...args),
    },
  },
};
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/notes/relationships.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  logLevel: "silent",
  plugins: [
    {
      name: "mock-vscode",
      setup(builder) {
        builder.onResolve({ filter: /^vscode$/ }, () => ({
          path: "vscode",
          namespace: "test",
        }));
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `const api = globalThis[Symbol.for("aic-notes.relationships-test-vscode")];
          export const { FileType, Uri, RelativePattern, workspace } = api;`,
        }));
      },
    },
  ],
});
// Match the extension's CommonJS bundle, including the YAML dependency's Node
// builtins. A data-URL ESM import has no require and fails before these tests run.
const module = { exports: {} };
runInThisContext(`(function(module, exports, require) {\n${bundled.outputFiles[0].text}\n})`, {
  filename: "relationships-test-bundle.cjs",
})(module, module.exports, createRequire(import.meta.url));
const { noteRelationshipsForTarget } = module.exports;
delete globalThis[apiKey];

function fixture({ files = [], directories = [], backslashes = false } = {}) {
  const folder = { name: "Project", uri: uri("/workspace/Project") };
  const entries = new Map([[folder.uri.path, FileType.Directory]]);
  const statCalls = [];
  const findCalls = [];
  const at = (relative = "") => uri(path.posix.join(folder.uri.path, relative));
  const add = (relative, type) => {
    const absolute = at(relative).path;
    entries.set(absolute, type);
    let parent = path.posix.dirname(absolute);
    while (parent.startsWith(folder.uri.path)) {
      entries.set(parent, FileType.Directory);
      parent = path.posix.dirname(parent);
    }
  };
  directories.forEach((name) => add(name, FileType.Directory));
  files.forEach((name) => add(name, FileType.File));
  activeWorkspace = {
    getWorkspaceFolder: (value) =>
      value.path === folder.uri.path ||
      value.path.startsWith(`${folder.uri.path}/`)
        ? folder
        : undefined,
    asRelativePath(value) {
      const relative = path.posix.relative(folder.uri.path, value.path);
      return backslashes ? relative.replaceAll("/", "\\") : relative;
    },
    async stat(value) {
      statCalls.push(value.path);
      if (!entries.has(value.path)) throw new Error("FileNotFound");
      return { type: entries.get(value.path) };
    },
    async readDirectory(value) {
      return [...entries]
        .filter(
          ([name]) =>
            name !== value.path && path.posix.dirname(name) === value.path,
        )
        .map(([name, type]) => [path.posix.basename(name), type]);
    },
    async findFiles(include, exclude) {
      findCalls.push({ include, exclude });
      return [...entries]
        .filter(
          ([name, type]) => type === FileType.File && name.endsWith(".note.md"),
        )
        .map(([name]) => uri(name));
    },
  };
  return { at, statCalls, findCalls };
}

test("same-named child folder cannot replace the reserved project context", async () => {
  const { at } = fixture({
    files: ["Project.note.md", "Project/file.js", "Project/file.note.md"],
  });
  const rows = await noteRelationshipsForTarget(at("Project/file.js"));
  assert.equal(rows.filter((row) => row.relation === "project").length, 1);
  assert.equal(
    rows.find((row) => row.path === "Project.note.md").targetPath,
    "",
  );
});

test("project root is always clickable note navigation, including its placeholder", async () => {
  for (const exists of [false, true]) {
    const { at } = fixture({ files: exists ? ["Project.note.md"] : [] });
    const rows = await noteRelationshipsForTarget(at());
    assert.deepEqual(rows, [
      {
        relation: "project",
        label: "Project",
        path: "Project.note.md",
        targetPath: "",
        depth: 0,
        exists,
        isCurrent: true,
      },
    ]);
  }
});

test("ancestor rows come only from actual notes, not intermediate directories", async () => {
  const { at, statCalls, findCalls } = fixture({
    files: [
      "src/feature/app.ts",
      "src/feature.note.md",
      "src/feature/app.note.md",
    ],
  });
  const rows = await noteRelationshipsForTarget(at("src/feature/app.ts"));
  assert.deepEqual(
    rows.map(({ relation, path, exists }) => ({ relation, path, exists })),
    [
      { relation: "project", path: "Project.note.md", exists: false },
      { relation: "parent", path: "src/feature.note.md", exists: true },
      { relation: "current", path: "src/feature/app.note.md", exists: true },
    ],
  );
  assert.equal(rows[0].isCurrent, false);
  assert.equal(statCalls.includes(at("src").path), false);
  assert.equal(findCalls.length, 1);
  assert.equal(findCalls[0].include.pattern, "**/*.note.md");
});

test("a missing current file note remains context without adding absent ancestors", async () => {
  const { at } = fixture({ files: ["src/feature/app.ts"], backslashes: true });
  const rows = await noteRelationshipsForTarget(at("src/feature/app.ts"));
  assert.deepEqual(
    rows.map(({ relation, path, exists }) => ({ relation, path, exists })),
    [
      { relation: "project", path: "Project.note.md", exists: false },
      { relation: "current", path: "src/feature/app.note.md", exists: false },
    ],
  );
});

test("the actual current folder can be a placeholder while its note-bearing parent stays clickable", async () => {
  const { at } = fixture({
    files: ["src.note.md"],
    directories: ["src/feature"],
  });
  const rows = await noteRelationshipsForTarget(at("src/feature"));
  assert.deepEqual(
    rows.map(({ relation, path, exists }) => ({ relation, path, exists })),
    [
      { relation: "project", path: "Project.note.md", exists: false },
      { relation: "parent", path: "src.note.md", exists: true },
      { relation: "current", path: "src/feature.note.md", exists: false },
    ],
  );
});

test("existing sibling and component notes retain their direct note destinations", async () => {
  const { at } = fixture({
    files: [
      "Project.note.md",
      "src/feature.note.md",
      "src/feature/app.ts",
      "src/feature/app.note.md",
      "src/other.note.md",
      "src/orphan.note.md",
    ],
    directories: ["src/other"],
  });
  const rows = await noteRelationshipsForTarget(at("src/feature"));
  assert.deepEqual(
    rows.map(({ relation, path }) => ({ relation, path })),
    [
      { relation: "project", path: "Project.note.md" },
      { relation: "current", path: "src/feature.note.md" },
      { relation: "component", path: "src/feature/app.note.md" },
      { relation: "sibling", path: "src/other.note.md" },
    ],
  );
  assert.ok(rows.every(({ exists }) => exists));
});

test("file context retains existing sibling notes without turning them into parents", async () => {
  const { at } = fixture({
    files: [
      "src/app.ts",
      "src/app.note.md",
      "src/other.ts",
      "src/other.note.md",
    ],
  });
  const rows = await noteRelationshipsForTarget(at("src/app.ts"));
  assert.deepEqual(
    rows.map(({ relation, path }) => ({ relation, path })),
    [
      { relation: "project", path: "Project.note.md" },
      { relation: "current", path: "src/app.note.md" },
      { relation: "sibling", path: "src/other.note.md" },
    ],
  );
});
