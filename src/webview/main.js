// The markdown editor webview — the FULL aic markdown session (owner
// 2026-07-03, reversing the same-day minimal directive: claim every *.md and
// carry the complete custom syntax): the reveal-rule handler set (headings,
// emphasis, inline code, lists + task boxes, links + tooltip, blockquote/hr/
// strikethrough, code fences), nested fenced-code highlighting (lazy chunks),
// and the three block widgets — the live table grid, the frontmatter props
// table, and in-place mermaid.
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
import { EditorState, Annotation, Prec, Compartment } from "@codemirror/state";
import { defaultKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { search, searchKeymap } from "@codemirror/search";

import { HANDLERS, decorationPlugin } from "../../vendor/markdown/session.js";
import { linkTooltip } from "../../vendor/markdown/link-tooltip.js";
import { listKeymap } from "../../vendor/markdown/handlers/list.js";
import { makeTableExtension } from "../../vendor/markdown/handlers/table.js";
import { makeFrontmatterExtension } from "../../vendor/markdown/handlers/frontmatter.js";
import { makeMermaidExtension } from "../../vendor/markdown/mermaid.js";
import { MARKDOWN_CSS } from "../../vendor/markdown/styles.js";
import { makeFencedMarkdown } from "./fenced-local.js";
import { darkHighlight } from "./highlight.js";
import { makeHost } from "./host-shim.js";
import { detailsExtension } from "./details.js";
import THEME_CSS from "./theme.css";

const api = acquireVsCodeApi();
const remote = Annotation.define();
const readOnlyCompartment = new Compartment();
const editableCompartment = new Compartment();
const secondarySurface = Boolean(document.getElementById("secondary-controls"));
if (secondarySurface) document.documentElement.classList.add("aic-secondary-shell");

const docState = { relativePath: "", generation: 0, readOnly: false, placeholder: false };
const host = makeHost(api, docState);

// bundled JetBrains Mono (OFL, dist/webview/fonts): the @font-face URLs must
// be built at runtime — they resolve against this script's own webview URI
const FONT_CSS = [
  ["JetBrainsMono-Regular.woff2", 400, "normal"],
  ["JetBrainsMono-Italic.woff2", 400, "italic"],
  ["JetBrainsMono-Bold.woff2", 700, "normal"],
  ["JetBrainsMono-BoldItalic.woff2", 700, "italic"],
]
  .map(
    ([file, weight, style]) =>
      `@font-face { font-family: "JetBrains Mono"; src: url("${new URL(`./fonts/${file}`, import.meta.url)}") format("woff2"); font-weight: ${weight}; font-style: ${style}; font-display: swap; }`,
  )
  .join("\n");

for (const css of [FONT_CSS, THEME_CSS, MARKDOWN_CSS]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

let view = null;
function setReadOnly(value) {
  docState.readOnly = secondarySurface && Boolean(value);
  if (view) {
    view.dispatch({
      effects: [
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(docState.readOnly)),
        editableCompartment.reconfigure(EditorView.editable.of(!docState.readOnly)),
      ],
    });
  }
  document.body.dataset.readOnly = String(docState.readOnly);
}

function wirePaneControls() {
  if (!secondarySurface) return;
  document.getElementById("pane-pin")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.pin" }),
  );
  document.getElementById("pane-target")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.target" }),
  );
  document.getElementById("pane-auth")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.auth" }),
  );
  document.getElementById("pane-clear")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.clear" }),
  );
}

// Nested fenced-code highlighting: the language sits in a Compartment so a
// lazily-loaded parser chunk can force a re-parse by reconfiguring with a
// fresh Language instance (aic session.js pattern). The cache outlives
// reconfigures — each language chunk loads once.
const langCompartment = new Compartment();
const fenceCache = new Map();
function fencedLang() {
  return makeFencedMarkdown({
    cache: fenceCache,
    onLoad: () => {
      if (view) view.dispatch({ effects: langCompartment.reconfigure(fencedLang()) });
    },
    onError: (structured) => host.ui.toast.error("markdown", structured),
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
        readOnlyCompartment.of(EditorState.readOnly.of(docState.readOnly)),
        editableCompartment.of(EditorView.editable.of(!docState.readOnly)),
        langCompartment.of(fencedLang()),
        // colors nested fenced-code tokens; markdown structure styling is
        // owned by the handler classes (theme.css bumps their specificity)
        syntaxHighlighting(darkHighlight, { fallback: true }),
        decorationPlugin(HANDLERS),
        linkTooltip(host),
        makeTableExtension(host),
        ...makeFrontmatterExtension(),
        makeMermaidExtension(),
        ...detailsExtension(host),
        drawSelection(),
        search({ top: true }),
        // List Enter must win over defaultKeymap for continuation and
        // renumbering. Replacement previews expose their
        // source only through the visible Edit source button.
        Prec.high(keymap.of(listKeymap)),
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
        EditorView.domEventHandlers({
          blur: () => {
            if (secondarySurface && !docState.readOnly && !docState.placeholder) {
              api.postMessage({ type: "save", reason: "blur" });
            }
            return false;
          },
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
      docState.readOnly = secondarySurface && Boolean(msg.readOnly);
      docState.placeholder = secondarySurface && Boolean(msg.placeholder);
      view?.destroy();
      view = makeEditor(msg.text);
      const requested = msg.selection;
      const saved = api.getState();
      const selection = requested ?? (saved?.path === msg.relativePath ? saved : null);
      if (selection) {
        const len = view.state.doc.length;
        try {
          view.dispatch({
            selection: {
              anchor: Math.max(0, Math.min(selection.anchor, len)),
              head: Math.max(0, Math.min(selection.head, len)),
            },
            scrollIntoView: true,
            annotations: [remote.of(true)],
          });
        } catch {
          /* stale saved selection — keep the default */
        }
      }
      if (!docState.readOnly) requestAnimationFrame(() => view?.focus());
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
    case "paneState": {
      document.title = msg.title;
      docState.placeholder = secondarySurface && Boolean(msg.hasPlaceholder);
      document.body.dataset.placeholder = String(docState.placeholder);
      const filename = document.getElementById("pane-filename");
      if (filename) filename.textContent = msg.title || "Linked Note";
      const breadcrumb = document.getElementById("pane-breadcrumb");
      if (breadcrumb) breadcrumb.textContent = msg.breadcrumb || "Workspace";
      const pin = document.getElementById("pane-pin");
      if (pin) {
        pin.setAttribute("aria-pressed", String(Boolean(msg.pinned)));
        pin.setAttribute("aria-label", msg.pinned ? "Unpin note" : "Pin note");
        pin.title = msg.pinned ? "Unpin and follow the active file" : "Pin note";
        pin.disabled = !msg.canPin;
      }
      const status = document.getElementById("pane-status");
      if (status) status.textContent = msg.status || "";
      if (secondarySurface) setReadOnly(Boolean(msg.readOnly));
      const auth = document.getElementById("pane-auth");
      if (auth) {
        const authLabel = msg.authPending
          ? msg.authConnected ? "Logging out…" : "Logging in…"
          : msg.authConnected ? "Log out" : "Log in";
        auth.setAttribute("aria-label", authLabel);
        auth.dataset.connected = String(Boolean(msg.authConnected));
        auth.disabled = Boolean(msg.authPending);
        auth.title = msg.authReconnect
          ? "Replace the unreadable local session by logging in again"
          : msg.authConnected ? "Remove only the encrypted local session" : "Log in to Standard Notes";
      }
      const target = document.getElementById("pane-target");
      if (target) {
        target.hidden = !msg.showPinnedActions;
        target.disabled = !msg.showPinnedActions || Boolean(msg.actionPending);
      }
      const clear = document.getElementById("pane-clear");
      if (clear) {
        clear.hidden = !msg.showPinnedActions;
        clear.disabled = !msg.showPinnedActions || Boolean(msg.readOnly) || Boolean(msg.actionPending);
      }
      const empty = document.getElementById("pane-empty");
      const editor = document.getElementById("editor");
      if (empty) empty.hidden = Boolean(msg.hasSurface);
      if (editor) editor.hidden = !msg.hasSurface;
      break;
    }
  }
});

wirePaneControls();
api.postMessage({ type: "ready" });
