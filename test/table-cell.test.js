// fillCell — inline markdown in table cells. Regression guard for the v0.5.1
// freeze: fillCell recurses, and a shared /g regex's lastIndex was rewound by
// the recursive call, so the outer loop re-matched its first token forever.
// A minimal DOM stub is enough — fillCell only creates/appends elements.

import test from "node:test";
import assert from "node:assert/strict";

function stubElement(tag) {
  return {
    tag,
    children: [],
    className: "",
    title: "",
    href: "",
    _text: "",
    set textContent(v) {
      this._text = v;
      this.children = [];
    },
    get textContent() {
      return this._text || this.children.map((c) => c.text ?? c.textContent).join("");
    },
    set onclick(_) {},
    appendChild(c) {
      this.children.push(c);
    },
  };
}

globalThis.document = {
  createElement: (tag) => stubElement(tag),
  createTextNode: (text) => ({ text }),
};

const { fillCell } = await import("../vendor/markdown/handlers/cell-inline.js");

const cell = (text) => {
  const td = stubElement("td");
  fillCell(td, text, null, () => {});
  return td;
};

test("a link with label terminates and nests the label (v0.5.1 hung here)", () => {
  const td = cell("[file](src/x.js) plain");
  assert.equal(td.children.length, 2);
  assert.equal(td.children[0].tag, "a");
  assert.equal(td.children[0].href, "src/x.js");
  assert.equal(td.children[0].textContent, "file");
  assert.equal(td.children[1].text, " plain");
});

test("bold wrapping a link nests both ways", () => {
  const td = cell("**[a](b)** and `c`");
  assert.equal(td.children[0].tag, "strong");
  assert.equal(td.children[0].children[0].tag, "a");
  assert.equal(td.children[1].text, " and ");
  assert.equal(td.children[2].tag, "code");
  assert.equal(td.children[2].textContent, "c");
});

test("italic, strike and plain segments split correctly", () => {
  const td = cell("a *b* ~~c~~");
  assert.deepEqual(
    td.children.map((c) => c.tag ?? "text"),
    ["text", "em", "text", "del"],
  );
});

test("plain text stays a single text node", () => {
  const td = cell("no markup here");
  assert.equal(td.children.length, 1);
  assert.equal(td.children[0].text, "no markup here");
});

test("two links in one cell both render (shared-state regression)", () => {
  const td = cell("[a](1) mid [b](2)");
  const tags = td.children.map((c) => c.tag ?? "text");
  assert.deepEqual(tags, ["a", "text", "a"]);
});
