import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "../vendor/markdown/language.js";
import { codeFences } from "../vendor/markdown/handlers/code-fence.js";

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
