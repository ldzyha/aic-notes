import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  isAgentVisible,
  noteMeta,
} from "../src/notes/frontmatter.js";

test("parse/stringify round-trip preserves keys, order and body", () => {
  const meta = noteMeta("app.js", "file-note");
  const body = "# notes: src/app.js\n\nSome body.\n";
  const text = stringifyFrontmatter(body, meta);
  assert.match(text, /\n---\n\n# notes:/u);
  const parsed = parseFrontmatter(text);
  assert.deepEqual(parsed.meta, meta);
  assert.equal(parsed.text, body);
  assert.equal(stringifyFrontmatter(parsed.text, parsed.meta), text);
});

test("parse coerces booleans and integers", () => {
  const { meta } = parseFrontmatter("---\na: true\nb: false\nc: 42\nd: hello\n---\n");
  assert.deepEqual(meta, { a: true, b: false, c: 42, d: "hello" });
});

test("no frontmatter → empty meta, body untouched", () => {
  const { meta, text } = parseFrontmatter("# just a body\n");
  assert.deepEqual(meta, {});
  assert.equal(text, "# just a body\n");
});

test("visibility gate: agent:false, private:true, visibility:private hide", () => {
  assert.equal(isAgentVisible("---\nagent: false\n---\nx"), false);
  assert.equal(isAgentVisible("---\nprivate: true\n---\nx"), false);
  assert.equal(isAgentVisible("---\nvisibility: private\n---\nx"), false);
  assert.equal(isAgentVisible("---\nagent: true\n---\nx"), true);
  assert.equal(isAgentVisible("no header"), true);
});
