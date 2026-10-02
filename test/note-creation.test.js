import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/notes/create.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});
function harness(template = null, existing = null) {
  const writes = [];
  const uri = (path) => ({
    scheme: "file",
    path,
    toString: () => `file://${path}`,
  });
  const folder = { uri: uri("/project"), name: "project" };
  const vscode = {
    Uri: {
      joinPath: (parent, ...paths) => uri([parent.path, ...paths].join("/")),
    },
    workspace: {
      fs: {
        stat: async () => {
          if (existing === null) throw new Error("Missing");
          return { type: 1 };
        },
        readFile: async () => {
          if (template === null) throw new Error("No explicit template");
          return new TextEncoder().encode(template);
        },
        writeFile: async (target, bytes) => {
          writes.push({
            path: target.path,
            text: new TextDecoder().decode(bytes),
            size: bytes.length,
          });
        },
      },
    },
  };
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => (name === "vscode" ? vscode : require(name)),
    TextEncoder,
    TextDecoder,
  });
  return { create: module.exports.ensureNoteFile, folder, writes };
}

test("explicitly creating file/folder/project notes writes an empty file by default", async () => {
  for (const level of ["file-note", "folder-note", "project-note"]) {
    const h = harness();
    await h.create(h.folder, "subject.note.md", level, "Subject");
    assert.deepEqual(h.writes, [
      { path: "/project/subject.note.md", text: "", size: 0 },
    ]);
  }
});

test("creating a note honors an explicitly supplied AIC template", async () => {
  const template = "# {{name}}\n\n```aic\n# Properties\nStatus | chosen\n```\n";
  const h = harness(template);
  await h.create(h.folder, "subject.note.md", "file-note", "Subject");
  assert.equal(h.writes[0].text, template.replace("{{name}}", "Subject"));
});

test("opening an existing note does not rewrite its authored content or insert a block", async () => {
  const h = harness("# {{name}} replacement", "Existing authored content");
  await h.create(h.folder, "subject.note.md", "file-note", "Subject");
  assert.equal(h.writes.length, 0);
});
