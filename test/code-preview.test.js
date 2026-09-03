import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownLanguage } from "../vendor/markdown/language.js";
import {
  codeFences,
  makeCodeFenceExtension,
} from "../vendor/markdown/handlers/code-fence.js";

test("code previews expose exact fenced content and exclude Mermaid", () => {
  const markdown = [
    "Intro",
    "",
    "```JavaScript",
    "const answer = 42;",
    "```",
    "",
    "```mermaid",
    "flowchart LR",
    "  A --> B",
    "```",
    "",
    "~~~",
    "plain text",
    "~~~",
  ].join("\n");
  const state = EditorState.create({ doc: markdown, extensions: [markdownLanguage] });
  const blocks = codeFences(state);

  assert.deepEqual(blocks.map(({ language, source }) => ({ language, source })), [
    { language: "javascript", source: "const answer = 42;" },
    { language: "", source: "plain text" },
  ]);
  assert.equal(state.sliceDoc(blocks[0].textFrom, blocks[0].textFrom + 5), "const");
});

test("closed code previews publish their complete source as an atomic range", () => {
  const markdown = "Before\n\n```text\none\ntwo\n```\n\nAfter";
  const from = markdown.indexOf("```text");
  const to = markdown.indexOf("```", from + 3) + 3;
  const state = EditorState.create({
    doc: markdown,
    selection: { anchor: markdown.length },
    extensions: [
      markdownLanguage,
      makeCodeFenceExtension({
        document: { createElement() {} },
      }),
    ],
  });
  const ranges = [];
  for (const provider of state.facet(EditorView.atomicRanges)) {
    provider({ state }).between(0, markdown.length, (rangeFrom, rangeTo) => {
      ranges.push([rangeFrom, rangeTo]);
    });
  }
  assert.deepEqual(ranges, [[from, to]]);
});
