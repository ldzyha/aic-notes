import test from "node:test";
import assert from "node:assert/strict";
import { importCandidates, remoteNoteTarget } from "../src/sync/import.js";

function remote(level, title, tagPath, uuid = `${level}-${title}`) {
  return {
    remoteUuid: uuid,
    title,
    tagPath,
    localContent: `---\ntitle: ${title}\nlevel: ${level}\n---\n\nbody\n`,
  };
}

test("remote project, folder, and file notes map to canonical sidecars", () => {
  assert.deepEqual(
    remoteNoteTarget(remote("project-note", "demo", ["demo"]), "demo"),
    {
      level: "project-note",
      notePath: "demo.note.md",
      targetPath: "",
      targetKind: "directory",
    },
  );
  assert.deepEqual(
    remoteNoteTarget(
      remote("folder-note", "components", ["demo", "src"]),
      "demo",
    ),
    {
      level: "folder-note",
      notePath: "src/components.note.md",
      targetPath: "src/components",
      targetKind: "directory",
    },
  );
  assert.deepEqual(
    remoteNoteTarget(remote("file-note", "app.ts", ["demo", "src"]), "demo"),
    {
      level: "file-note",
      notePath: "src/app.note.md",
      targetPath: "src/app.ts",
      targetKind: "file",
    },
  );
});

test("project-tagged Markdown filenames map to exact documents and free-standing notes", () => {
  assert.deepEqual(
    remoteNoteTarget(
      {
        remoteUuid: "doc",
        title: "README.md",
        tagPath: ["demo", "docs"],
        localContent: "# Read me",
      },
      "demo",
    ),
    {
      level: "document",
      notePath: "docs/README.md",
      targetPath: "docs/README.md",
      targetKind: "file",
    },
  );
  assert.deepEqual(
    remoteNoteTarget(
      {
        remoteUuid: "note",
        title: "topic.note.md",
        tagPath: ["demo"],
        localContent: "Body",
      },
      "demo",
    ),
    {
      level: "note",
      notePath: "topic.note.md",
      targetPath: null,
      targetKind: null,
    },
  );
});

test("remote import rejects unrelated, unsafe, and non-AIC notes", () => {
  assert.equal(
    remoteNoteTarget(remote("file-note", "app.ts", ["other"]), "demo"),
    null,
  );
  assert.equal(
    remoteNoteTarget(remote("file-note", "../secret", ["demo"]), "demo"),
    null,
  );
  assert.equal(
    remoteNoteTarget(
      { remoteUuid: "free", tagPath: ["demo"], localContent: "plain" },
      "demo",
    ),
    null,
  );
  assert.equal(
    remoteNoteTarget(
      {
        remoteUuid: "free",
        title: "plain",
        tagPath: ["demo"],
        localContent: "plain",
      },
      "demo",
    ),
    null,
  );
});

test("remote import drops ambiguous destinations instead of choosing a note", () => {
  const first = remote("file-note", "app.ts", ["demo", "src"], "one");
  const second = remote("file-note", "app.js", ["demo", "src"], "two");
  assert.deepEqual(importCandidates([first, second], "demo"), []);
});

test("remote import deterministically binds byte-identical duplicate identities", () => {
  const later = remote("file-note", "app.ts", ["demo", "src"], "z-note");
  const canonical = remote("file-note", "app.ts", ["demo", "src"], "a-note");
  assert.deepEqual(importCandidates([later, canonical], "demo"), [
    {
      remote: canonical,
      level: "file-note",
      notePath: "src/app.note.md",
      targetPath: "src/app.ts",
      targetKind: "file",
    },
  ]);
});

test("remote import rejects sidecars whose Standard Notes title disagrees with frontmatter", () => {
  const inconsistent = remote("file-note", "app.ts", ["demo", "src"], "bad");
  inconsistent.title = "other.ts";
  assert.equal(remoteNoteTarget(inconsistent, "demo"), null);
});
