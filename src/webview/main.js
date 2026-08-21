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

const docState = { relativePath: "", generation: 0, readOnly: false };
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
  if (view && !docState.readOnly) requestAnimationFrame(() => view?.focus());
}

function wirePaneControls() {
  if (!secondarySurface) return;
  document.getElementById("pane-pin")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.pin" }),
  );
  document.getElementById("pane-target")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.target" }),
  );
  document.getElementById("pane-sync")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.sync" }),
  );
  document.getElementById("pane-auth")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.auth" }),
  );
  document.getElementById("pane-breadcrumb")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.reveal" }),
  );
  const menuButton = document.getElementById("pane-note-actions");
  const menu = document.getElementById("pane-note-menu");
  const closeMenu = () => {
    if (!menu || !menuButton) return;
    menu.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  };
  menuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuButton.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) menu.querySelector("button:not(:disabled)")?.focus();
  });
  document.getElementById("pane-clear")?.addEventListener("click", () => {
    closeMenu();
    api.postMessage({ type: "pane.clear" });
  });
  document.getElementById("pane-delete")?.addEventListener("click", () => {
    closeMenu();
    api.postMessage({ type: "pane.delete" });
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!menu?.hidden && !target?.closest(".aic-pane-menu-wrap")) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu?.hidden) {
      closeMenu();
      menuButton?.focus();
    }
  });
  document.getElementById("pane-create")?.addEventListener("click", () =>
    api.postMessage({ type: "pane.create" }),
  );
  document.getElementById("pane-auto")?.addEventListener("change", (event) =>
    api.postMessage({ type: "pane.autoOpen", value: event.currentTarget.checked }),
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
        // List Enter/Space must win over defaultKeymap for continuation,
        // renumbering, and task toggling. Replacement previews expose their
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
      const filename = document.getElementById("pane-filename");
      if (filename) filename.textContent = msg.title || "Linked Note";
      const breadcrumb = document.getElementById("pane-breadcrumb");
      if (breadcrumb) {
        breadcrumb.textContent = msg.breadcrumb || "Workspace";
        breadcrumb.disabled = !msg.breadcrumb;
        breadcrumb.title = msg.breadcrumb ? `Reveal ${msg.breadcrumb} in Explorer` : "";
      }
      const pin = document.getElementById("pane-pin");
      if (pin) {
        pin.textContent = msg.pinned ? "Unpin" : "Pin";
        pin.setAttribute("aria-pressed", String(Boolean(msg.pinned)));
      }
      const auto = document.getElementById("pane-auto");
      if (auto) auto.checked = Boolean(msg.autoOpen);
      const status = document.getElementById("pane-status");
      if (status) status.textContent = msg.status || "";
      if (secondarySurface) setReadOnly(Boolean(msg.readOnly));
      const auth = document.getElementById("pane-auth");
      if (auth) {
        auth.textContent = msg.authPending
          ? msg.authConnected ? "Logging out…" : "Logging in…"
          : msg.authConnected ? "Log out" : "Log in";
        auth.disabled = Boolean(msg.authPending);
        auth.title = msg.authReconnect
          ? "Replace the unreadable local session by logging in again"
          : msg.authConnected ? "Remove only the encrypted local session" : "Log in to Standard Notes";
      }
      const detail = document.getElementById("pane-empty-detail");
      if (detail) {
        detail.textContent = msg.candidatePath
          ? "Create the canonical sidecar for the focused source:"
          : "Focus a saved workspace source file.";
      }
      const candidate = document.getElementById("pane-candidate");
      if (candidate) candidate.textContent = msg.candidatePath || "";
      const create = document.getElementById("pane-create");
      if (create) {
        create.hidden = !msg.candidatePath;
        create.disabled = !msg.canCreate;
      }
      for (const id of ["pane-target", "pane-sync"]) {
        const control = document.getElementById(id);
        if (control) control.disabled = !msg.hasNote;
      }
      const noteActions = document.getElementById("pane-note-actions");
      if (noteActions) {
        noteActions.disabled = !msg.hasNote || Boolean(msg.actionPending);
        noteActions.closest(".aic-pane-menu-wrap").hidden = !msg.hasNote;
      }
      if (!msg.hasNote || msg.actionPending) {
        const menu = document.getElementById("pane-note-menu");
        if (menu) menu.hidden = true;
        noteActions?.setAttribute("aria-expanded", "false");
      }
      const clear = document.getElementById("pane-clear");
      if (clear) clear.disabled = Boolean(msg.readOnly) || Boolean(msg.actionPending);
      const remove = document.getElementById("pane-delete");
      if (remove) remove.disabled = Boolean(msg.actionPending);
      const empty = document.getElementById("pane-empty");
      const editor = document.getElementById("editor");
      if (empty) empty.hidden = Boolean(msg.hasNote);
      if (editor) editor.hidden = !msg.hasNote;
      break;
    }
  }
});

wirePaneControls();
api.postMessage({ type: "ready" });
