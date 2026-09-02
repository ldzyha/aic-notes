import test from "node:test";
import assert from "node:assert/strict";
import {
  isManagedNoteName,
  isMarkdownDocumentName,
  stampFileProperties,
} from "../vendor/aic-editor-core/file-properties.js";

test("only note sidecars receive managed file properties", () => {
  assert.equal(isManagedNoteName("docs/map.md"), false);
  assert.equal(isManagedNoteName("docs/map.note.md"), true);
  assert.equal(isMarkdownDocumentName("docs/map.note.md"), true);
  assert.equal(isMarkdownDocumentName("docs/map.txt"), false);
});

test("file properties contain only filename, creation, and explicit-save update", () => {
  const stamped = stampFileProperties("# Map\n", {
    fileName: "docs/00-documentation-map.note.md",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-09-01T18:00:00.000Z",
  });
  assert.equal(
    stamped,
    "---\n" +
      "file: 00-documentation-map.note.md\n" +
      "created: 2026-08-20T10:00:00.000Z\n" +
      "updated: 2026-09-01T18:00:00.000Z\n" +
      "---\n\n" +
      "# Map\n",
  );
});

test("restamping preserves authored note properties, creation, and body", () => {
  const source =
    "---\r\n" +
    "title: old\r\n" +
    "status: live\r\n" +
    "created: 2026-07-10\r\n" +
    "updated: 2026-07-11\r\n" +
    "---\r\n\r\n" +
    "Body  \r\n";
  assert.equal(
    stampFileProperties(source, {
      fileName: "renamed.note.md",
      createdAt: "ignored",
      updatedAt: "2026-09-01T18:05:00.000Z",
    }),
    "---\r\n" +
      "file: renamed.note.md\r\n" +
      "created: 2026-07-10\r\n" +
      "updated: 2026-09-01T18:05:00.000Z\r\n" +
      "title: old\r\n" +
      "status: live\r\n" +
      "---\r\n\r\n" +
      "Body  \r\n",
  );
});

test("restamping removes the complete legacy generated note signature", () => {
  const source =
    "---\n" +
    "file: app.note.md\n" +
    "created: 2026-07-10\n" +
    "updated: 2026-07-11\n" +
    "title: app.js\n" +
    "level: file-note\n" +
    "scope: \n" +
    "status: live\n" +
    "agent: true\n" +
    "owner: team-a\n" +
    "---\n\n" +
    "Body\n";
  assert.equal(
    stampFileProperties(source, {
      fileName: "app.note.md",
      updatedAt: "2026-09-02T08:00:00.000Z",
    }),
    "---\n" +
      "file: app.note.md\n" +
      "created: 2026-07-10\n" +
      "updated: 2026-09-02T08:00:00.000Z\n" +
      "owner: team-a\n" +
      "---\n\n" +
      "Body\n",
  );
});

test("ordinary Markdown documents remain byte-identical", () => {
  const source = "---\nstatus: document\n---\n\n# Document\n";
  assert.equal(
    stampFileProperties(source, {
      fileName: "file.md",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-09-01T18:00:00.000Z",
    }),
    source,
  );
});

test("legacy managed properties are removed from ordinary Markdown", () => {
  const source =
    "---\nfile: map.md\ncreated: 2026-08-20\nupdated: 2026-09-01\nstatus: draft\n---\n\n# Map\n";
  assert.equal(
    stampFileProperties(source, {
      fileName: "map.md",
      updatedAt: "2026-09-02T08:00:00.000Z",
    }),
    "---\nstatus: draft\n---\n\n# Map\n",
  );
});
