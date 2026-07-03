// The webview editor — aic's detached.js assembly recipe plus the buffer
// session's StateField extensions the detached editor omits (tables,
// frontmatter props, mermaid widgets, link tooltip, nested fence
// highlighting). NO CM history: the TextDocument owns undo/redo — Ctrl+Z/Y
// post to the extension host, the resulting document change flows back as an
// external (remote-tagged) transaction.
//
// Sync protocol (see src/editor/provider.js): the webview applies its own
// edits locally and posts {type:"edit", changes, generation}; the extension
// applies them FIFO. Any non-echo document change (undo, git checkout,
// another editor) arrives as {type:"external"} with a bumped generation; a
// webview edit carrying a stale generation is discarded host-side and
// answered with a full {type:"reset"}.

import { EditorView, keymap, drawSelection } from "@codemirror/view";
import { EditorState, Compartment, Annotation, Prec } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";
import { MatchDecorator, ViewPlugin, Decoration } from "@codemirror/view";

import { HANDLERS, decorationPlugin } from "../../vendor/markdown/session.js";
import { listKeymap } from "../../vendor/markdown/handlers/list.js";
import { makeTableExtension, blockEnterKeymap } from "../../vendor/markdown/handlers/table.js";
import {
  makeFrontmatterExtension,
  frontmatterEnterKeymap,
} from "../../vendor/markdown/handlers/frontmatter.js";
import { linkTooltip } from "../../vendor/markdown/link-tooltip.js";
import { makeMermaidExtension } from "../../vendor/markdown/mermaid.js";
import { MARKDOWN_CSS } from "../../vendor/markdown/styles.js";
import { makeFencedMarkdown } from "./fenced-local.js";
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

// ---- wiki links ([[path]] / [[name]] / [[path|alias]]) --------------------
// aic resolves these as chat-context links; here Ctrl/Cmd+click opens the
// referenced note (LINK_RE semantics, resolved extension-side).
const wikiMark = Decoration.mark({ class: "cm-md-link cm-md-link-local cm-md-wikilink" });
const wikiDecorator = new MatchDecorator({
  regexp: /\[\[([^\]]+)\]\]/g,
  decoration: () => wikiMark,
});
const wikiPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = wikiDecorator.createDeco(view);
    }
    update(u) {
      this.decorations = wikiDecorator.updateDeco(u, this.decorations);
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(event, view) {
        if (!(event.ctrlKey || event.metaKey)) return false;
        const el = event.target instanceof Element && event.target.closest(".cm-md-wikilink");
        if (!el) return false;
        const pos = view.posAtDOM(el);
        const line = view.state.doc.lineAt(pos);
        const m = [...line.text.matchAll(/\[\[([^\]]+)\]\]/g)].find(
          (x) => line.from + x.index <= pos && pos <= line.from + x.index + x[0].length,
        );
        if (!m) return false;
        event.preventDefault();
        host.bus.publish("wiki.open", { target: m[1] });
        return true;
      },
    },
  },
);

// ---- editor assembly -------------------------------------------------------

let view = null;
const languageSlot = new Compartment();
const fenceCache = new Map();

function language() {
  return makeFencedMarkdown({
    cache: fenceCache,
    onLoad() {
      // reconfigure to force a re-parse that now nests the cached parser
      view?.dispatch({ effects: languageSlot.reconfigure(language()) });
    },
    onError(structured) {
      api.postMessage({ type: "toast", scope: "markdown", message: structured });
    },
  });
}

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
        languageSlot.of(language()),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        decorationPlugin(HANDLERS),
        makeTableExtension(host),
        ...makeFrontmatterExtension(),
        makeMermaidExtension(),
        linkTooltip(host),
        wikiPlugin,
        drawSelection(),
        search({ top: true }),
        // editing keys (Enter list continuation, arrow-into-block) must win
        // over defaultKeymap
        Prec.high(keymap.of([...listKeymap, ...blockEnterKeymap, ...frontmatterEnterKeymap])),
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
