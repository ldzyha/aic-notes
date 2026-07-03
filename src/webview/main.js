// The note editor webview — deliberately MINIMAL (owner 2026-07-03: "маємо
// редагувати лише на таблиці, пропси, мермейд — решта має бути на базі вс
// код"): plain markdown text editing with basic syntax colors, enhanced ONLY
// by the three aic widgets — the live table grid, the frontmatter props
// table, and in-place mermaid. No reveal-rule styling, no link tooltip, no
// nested fence parsers — regular *.md files open in the native VS Code
// editor; this custom editor claims *.note.md only.
//
// NO CM history: the TextDocument owns undo/redo — Ctrl+Z/Y post to the
// extension host, the resulting document change flows back as a remote-tagged
// transaction.
//
// Sync protocol (see src/editor/provider.js): the webview applies its own
// edits locally and posts {type:"edit", changes, generation}; the extension
// applies them FIFO. Any non-echo document change (undo, git checkout,
// another editor) arrives as {type:"external"} with a bumped generation; a
// webview edit carrying a stale generation is discarded host-side and
// answered with a full {type:"reset"}.

import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState, Annotation, Prec } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";

import { markdownLanguage } from "../../vendor/markdown/language.js";
import { makeTableExtension, blockEnterKeymap } from "../../vendor/markdown/handlers/table.js";
import {
  makeFrontmatterExtension,
  frontmatterEnterKeymap,
} from "../../vendor/markdown/handlers/frontmatter.js";
import { makeMermaidExtension } from "../../vendor/markdown/mermaid.js";
import { MARKDOWN_CSS } from "../../vendor/markdown/styles.js";
import { makeHost } from "./host-shim.js";
import THEME_CSS from "./theme.css";

const api = acquireVsCodeApi();
const remote = Annotation.define();

const docState = { relativePath: "", generation: 0 };
const host = makeHost(api, docState);

for (const css of [THEME_CSS, MARKDOWN_CSS]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

let view = null;

function postEdit(update) {
  const changes = [];
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  if (changes.length) api.postMessage({ type: "edit", changes, generation: docState.generation });
}

function makeEditor(text) {
  const parent = document.getElementById("editor");
  parent.innerHTML = "";
  return new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        markdownLanguage,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        makeTableExtension(host),
        ...makeFrontmatterExtension(),
        makeMermaidExtension(),
        drawSelection(),
        search({ top: true }),
        // arrow-into-block must win over defaultKeymap's cursor moves —
        // it is how the caret ENTERS a rendered table/props/mermaid block
        Prec.high(keymap.of([...blockEnterKeymap, ...frontmatterEnterKeymap])),
        keymap.of([
          // the TextDocument owns the undo stack — route the chords host-side
          { key: "Mod-z", run: () => (api.postMessage({ type: "undo" }), true) },
          { key: "Mod-y", mac: "Mod-Shift-z", run: () => (api.postMessage({ type: "redo" }), true) },
          { key: "Mod-Shift-z", run: () => (api.postMessage({ type: "redo" }), true) },
          { key: "Mod-s", run: () => (api.postMessage({ type: "save" }), true) },
          ...searchKeymap,
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping, // a note wraps, never scrolls sideways
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(remote))) {
            postEdit(update);
          }
          if (update.selectionSet || update.docChanged) {
            const { anchor, head } = update.state.selection.main;
            api.setState({ anchor, head, path: docState.relativePath });
          }
        }),
      ],
    }),
  });
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      docState.relativePath = msg.relativePath;
      docState.generation = msg.generation;
      view?.destroy();
      view = makeEditor(msg.text);
      const saved = api.getState();
      if (saved && saved.path === msg.relativePath) {
        const len = view.state.doc.length;
        try {
          view.dispatch({
            selection: { anchor: Math.min(saved.anchor, len), head: Math.min(saved.head, len) },
            scrollIntoView: true,
            annotations: [remote.of(true)],
          });
        } catch {
          /* stale saved selection — keep the default */
        }
      }
      view.focus();
      break;
    }
    case "external": {
      if (!view) return;
      docState.generation = msg.generation;
      view.dispatch({
        changes: msg.changes,
        annotations: [remote.of(true)],
      });
      break;
    }
    case "reset": {
      if (!view) return;
      docState.generation = msg.generation;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: msg.text },
        annotations: [remote.of(true)],
      });
      break;
    }
  }
});

api.postMessage({ type: "ready" });
