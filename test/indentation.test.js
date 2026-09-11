import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditorState } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import { ensureSyntaxTree } from "@codemirror/language";
import { makeFencedMarkdown } from "../src/webview/fenced-local.js";
import { listKeymap } from "../vendor/markdown/handlers/list.js";
import { editorIndentation } from "../vendor/aic-editor-core/indentation.js";

function editor(doc, position = doc.length, readOnly = false) {
  const view = {
    state: EditorState.create({
      doc,
      selection: { anchor: position },
      extensions: [
        EditorState.readOnly.of(readOnly),
        editorIndentation({ continueList: listKeymap[0].run }),
        makeFencedMarkdown({
          cache: new Map([["js", javascriptLanguage.parser]]),
          onLoad() {},
        }),
      ],
    }),
    dispatch: (value) => {
      view.state = value.state ?? view.state.update(value).state;
    },
  };
  return view;
}
function press(view, key, shift = false) {
  const binding = view.state
    .facet(keymap)
    .flat()
    .find((entry) => entry.key === key);
  return (shift ? binding.shift : binding.run)(view);
}

test("VS Code uses shared indentation before the language keymap in both surfaces", async () => {
  const source = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /vendor\/aic-editor-core\/indentation\.js/u);
  assert.ok(
    source.indexOf("editorIndentation({") <
      source.indexOf("langCompartment.of(fencedLang())"),
  );
  assert.doesNotMatch(source, /Prec\.high\(keymap\.of\(listKeymap\)\)/u);
});

test("VS Code raw Markdown and Mermaid preserve leading whitespace", () => {
  for (const source of [
    "    raw",
    "\t\traw",
    "```mermaid\ngraph TD\n    A --> B\n```\n",
  ]) {
    const position = source.includes("mermaid")
      ? source.indexOf("B") + 1
      : source.length;
    const view = editor(source, position);
    press(view, "Enter");
    const prefix = source.startsWith("\t") ? "\t\t" : "    ";
    assert.equal(
      view.state.doc.toString(),
      source.slice(0, position) + "\n" + prefix + source.slice(position),
    );
  }
});

test("VS Code nested language parser provides JS indentation", () => {
  const view = editor("```js\nif (true) {\n```\n", 17);
  // This test exercises a loaded nested language, not the background parse
  // scheduler's wall-clock budget on a busy browser/CI worker.
  assert.ok(ensureSyntaxTree(view.state, view.state.doc.length, 5000));
  press(view, "Enter");
  assert.equal(view.state.doc.toString(), "```js\nif (true) {\n  \n```\n");
});

test("VS Code list continuation, Tab nesting and read-only safety are preserved", () => {
  const view = editor("- [x] item");
  press(view, "Tab");
  press(view, "Enter");
  assert.equal(view.state.doc.toString(), "  - [x] item\n  - [ ] ");
  press(view, "Tab", true);
  assert.equal(view.state.doc.toString(), "  - [x] item\n- [ ] ");
  const locked = editor("- item", 6, true);
  press(locked, "Enter");
  press(locked, "Tab");
  assert.equal(locked.state.doc.toString(), "- item");
});
