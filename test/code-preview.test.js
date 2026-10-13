import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";
import { markdownLanguage } from "../vendor/markdown/language.js";
import {
  codeFenceHandler,
  codeFences,
  makeCodeFenceExtension,
  plainCodeFenceHandler,
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

test("code-fence chip decoration skips fences owned by Mermaid and AIC block widgets", () => {
  const languages = ["mermaid", "aic", "aic-security", "js"];
  const markdown = languages
    .map((language) => "```" + language + "\nbody\n```")
    .join("\n\n");
  const state = EditorState.create({ doc: markdown, extensions: [markdownLanguage] });
  const decorations = {};
  const plain = {};
  ensureSyntaxTree(state, state.doc.length, 1000).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      const language = state.doc.lineAt(node.from).text.slice(3);
      decorations[language] = codeFenceHandler.decorate(node, { state }, () => false);
      plain[language] = plainCodeFenceHandler.decorate(node, { state }, () => false);
    },
  });
  assert.deepEqual(Object.keys(decorations), languages);
  assert.deepEqual(decorations.mermaid, []);
  assert.deepEqual(decorations.aic, []);
  assert.deepEqual(decorations["aic-security"], []);
  assert.equal(decorations.js.filter(({ line }) => line).length, 3);
  assert.equal(plain.aic.filter(({ line }) => line).length, 3);
  assert.deepEqual(
    codeFences(state).map(({ language }) => language),
    ["js"],
  );
});
