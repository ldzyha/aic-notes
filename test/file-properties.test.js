import test from "node:test";
import assert from "node:assert/strict";
import {
  isMarkdownDocumentName,
  stampFileProperties,
} from "../vendor/aic-editor-core/file-properties.js";

test("only ordinary Markdown filenames receive managed file properties", () => {
  assert.equal(isMarkdownDocumentName("docs/map.md"), true);
  assert.equal(isMarkdownDocumentName("docs/map.note.md"), false);
  assert.equal(isMarkdownDocumentName("docs/map.txt"), false);
});

test("file properties contain only filename, creation, and explicit-save update", () => {
  const stamped = stampFileProperties("# Map\n", {
    fileName: "docs/00-documentation-map.md",
    createdAt: "2026-08-20T10:00:00.000Z",
    updatedAt: "2026-09-01T18:00:00.000Z",
  });
  assert.equal(
    stamped,
    "---\n" +
      "file: 00-documentation-map.md\n" +
      "created: 2026-08-20T10:00:00.000Z\n" +
      "updated: 2026-09-01T18:00:00.000Z\n" +
      "---\n\n" +
      "# Map\n",
  );
});

test("restamping preserves creation and body while replacing legacy properties", () => {
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
      fileName: "renamed.md",
      createdAt: "ignored",
      updatedAt: "2026-09-01T18:05:00.000Z",
    }),
    "---\r\n" +
      "file: renamed.md\r\n" +
      "created: 2026-07-10\r\n" +
      "updated: 2026-09-01T18:05:00.000Z\r\n" +
      "---\r\n\r\n" +
      "Body  \r\n",
  );
});

test("note sidecars remain byte-identical", () => {
  const source = "---\nlevel: file-note\n---\n\n# Note\n";
  assert.equal(
    stampFileProperties(source, {
      fileName: "file.note.md",
      createdAt: "2026-08-20T10:00:00.000Z",
      updatedAt: "2026-09-01T18:00:00.000Z",
    }),
    source,
  );
});
