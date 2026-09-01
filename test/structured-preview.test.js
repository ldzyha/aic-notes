import test from "node:test";
import assert from "node:assert/strict";
import {
  addProperty,
  addTableColumn,
  addTableRow,
  moveProperty,
  moveTableColumn,
  moveTableRow,
  parseFrontmatterRows,
  selectionRevealsPreview,
  serializeFrontmatter,
  serializeTable,
  updateProperty,
  updateTableCell,
} from "../vendor/aic-editor-core/structured-preview.js";

test("only a non-empty selection reveals intersected preview source", () => {
  assert.equal(selectionRevealsPreview([{ from: 4, to: 4 }], 0, 10), false);
  assert.equal(selectionRevealsPreview([{ from: 2, to: 8 }], 0, 10), true);
  assert.equal(selectionRevealsPreview([{ from: 10, to: 20 }], 0, 10), false);
  assert.equal(selectionRevealsPreview([{ from: 20, to: 0 }], 4, 8), true);
});

test("table operations serialize one stable Markdown block", () => {
  const initial = {
    header: ["A", "B"],
    aligns: ["left", "right"],
    rows: [["1", "2"]],
  };
  const changed = updateTableCell(initial, 0, 1, "two | values");
  const withRow = addTableRow(changed);
  const withColumn = addTableColumn(withRow, "C");
  const movedRow = moveTableRow(
    { ...withColumn, rows: [["x", "y", "z"], ...withColumn.rows] },
    0,
    2,
  );
  const movedColumn = moveTableColumn(movedRow, 2, 0);
  assert.equal(
    serializeTable(movedColumn),
    "| C | A | B |\n| --- | :--- | ---: |\n|  | 1 | two \\| values |\n|  |  |  |\n| z | x | y |",
  );
  assert.deepEqual(initial.rows, [["1", "2"]]);
});

test("property operations remain valid simple YAML", () => {
  const initial = [{ key: "status", value: "idea" }];
  const added = addProperty(addProperty(initial));
  const changed = updateProperty(added, 1, "value", "in progress");
  const moved = moveProperty(changed, 1, 0);
  assert.equal(
    serializeFrontmatter(moved),
    "---\nproperty: in progress\nstatus: idea\nproperty_2: \n---",
  );
});

test("nested property operations preserve hierarchy and move complete sibling branches", () => {
  const body = [
    "document:",
    "  type: index",
    "traceability:",
    "  requirements:",
    "    - type: fsd",
    "      title: Engraving Elevation",
    "      role: primary",
    "    - type: jira",
    "      id: EPC-32962",
    "      role: v1-study",
  ].join("\n");
  const rows = parseFrontmatterRows(body);
  assert.ok(rows);
  assert.deepEqual(
    rows.map(({ key, depth, sequence }) => ({ key, depth, sequence })),
    [
      { key: "document", depth: 0, sequence: false },
      { key: "type", depth: 1, sequence: false },
      { key: "traceability", depth: 0, sequence: false },
      { key: "requirements", depth: 1, sequence: false },
      { key: "type", depth: 2, sequence: true },
      { key: "title", depth: 3, sequence: false },
      { key: "role", depth: 3, sequence: false },
      { key: "type", depth: 2, sequence: true },
      { key: "id", depth: 3, sequence: false },
      { key: "role", depth: 3, sequence: false },
    ],
  );
  assert.equal(serializeFrontmatter(rows), `---\n${body}\n---`);
  const changed = updateProperty(rows, 8, "value", "EPC-33349");
  const moved = moveProperty(changed, 7, 4);
  assert.match(
    serializeFrontmatter(moved),
    /- type: jira\n      id: EPC-33349\n      role: v1-study\n    - type: fsd/u,
  );
});
