// The markdown editor webview — the FULL aic markdown session (owner
// 2026-07-03, reversing the same-day minimal directive: claim every *.md and
// carry the complete custom syntax): the reveal-rule handler set (headings,
// emphasis, inline code, lists + task boxes, direct link actions, blockquote/hr/
// strikethrough, code fences), nested fenced-code highlighting (lazy chunks),
// and the three block widgets — the live table grid, the frontmatter props
// table, and in-place mermaid.
//
// NO CM history: the TextDocument owns undo/redo — Ctrl+Z/Y post to the
// extension host, the resulting document change flows back as a remote-tagged
// transaction.
//
// Edit protocol (see src/editor/provider.js): the webview applies its own
// edits locally and posts {type:"edit", changes, generation}; the extension
// applies them FIFO. Any non-echo document change (undo, git checkout,
// another editor) arrives as {type:"external"} with a bumped generation; a
// webview edit carrying a stale generation is discarded host-side and
// answered with a full {type:"reset"}.

import {
  EditorView,
  keymap,
  drawSelection,
  placeholder,
} from "@codemirror/view";
import { EditorState, Annotation, Prec, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";

import { HANDLERS, decorationPlugin } from "../../vendor/markdown/session.js";
import { makeLinkActionsExtension } from "../../vendor/markdown/link-actions.js";
import { listKeymap } from "../../vendor/markdown/handlers/list.js";
import { makeTableExtension } from "../../vendor/markdown/handlers/table.js";
import {
  makeFrontmatterExtension,
  setNoteRelationships,
} from "../../vendor/markdown/handlers/frontmatter.js";
import { makeCodeFenceExtension } from "../../vendor/markdown/handlers/code-fence.js";
import { makeMermaidExtension } from "../../vendor/markdown/mermaid.js";
import { MARKDOWN_CSS } from "../../vendor/markdown/styles.js";
import { makeFencedMarkdown } from "./fenced-local.js";
import { darkHighlight } from "./highlight.js";
import { makeHost } from "./host-shim.js";
import { detailsExtension } from "./details.js";
import { DraftSession } from "../../vendor/aic-editor-core/draft-session.js";
import { wirePreviewSelection } from "../../vendor/aic-editor-core/structured-preview.js";
import {
  SLASH_SNIPPET_PLACEHOLDER,
  slashSnippetExtension,
} from "../../vendor/aic-editor-core/slash-snippets.js";
import ICONS_CSS from "../../vendor/aic-editor-core/icons.css";
import MERMAID_VIEWPORT_CSS from "../../vendor/aic-editor-core/mermaid-viewport.css";
import SLASH_SNIPPETS_CSS from "../../vendor/aic-editor-core/slash-snippets.css";
import THEME_CSS from "./theme.css";

const api = acquireVsCodeApi();
const remote = Annotation.define();
const secondarySurface = Boolean(document.getElementById("secondary-controls"));
if (secondarySurface)
  document.documentElement.classList.add("aic-secondary-shell");

const docState = {
  relativePath: "",
  generation: 0,
  placeholder: false,
  relationships: [],
};
const draft = new DraftSession();
const host = makeHost(api, docState);

function reflectSaveState() {
  if (!secondarySurface) return;
  document.body.dataset.saveState = draft.dirty
    ? "dirty"
    : docState.placeholder
      ? "placeholder"
      : "saved";
}

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

for (const css of [
  FONT_CSS,
  THEME_CSS,
  MARKDOWN_CSS,
  ICONS_CSS,
  MERMAID_VIEWPORT_CSS,
  SLASH_SNIPPETS_CSS,
]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

let view = null;

function wirePaneControls() {
  if (!secondarySurface) return;
  document
    .getElementById("pane-pin")
    ?.addEventListener("click", () => api.postMessage({ type: "pane.pin" }));
  document
    .getElementById("pane-target")
    ?.addEventListener("click", () => api.postMessage({ type: "pane.target" }));
  document
    .getElementById("pane-clear")
    ?.addEventListener("click", () => api.postMessage({ type: "pane.clear" }));
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
      if (view)
        view.dispatch({ effects: langCompartment.reconfigure(fencedLang()) });
    },
    onError: (structured) => host.ui.toast.error("markdown", structured),
  });
}

function postEdit(update) {
  const changes = [];
  update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    changes.push({ from: fromA, to: toA, insert: inserted.toString() });
  });
  if (changes.length)
    api.postMessage({ type: "edit", changes, generation: docState.generation });
}

function commitDraft(reason) {
  if (!secondarySurface || !view) return;
  const commit = draft.begin(reason);
  if (commit) api.postMessage({ type: "commit", ...commit });
}

function makeEditor(text) {
  const parent = document.getElementById("editor");
  parent.innerHTML = "";
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        langCompartment.of(fencedLang()),
        placeholder(SLASH_SNIPPET_PLACEHOLDER),
        slashSnippetExtension(),
        // colors nested fenced-code tokens; markdown structure styling is
        // owned by the handler classes (theme.css bumps their specificity)
        syntaxHighlighting(darkHighlight, { fallback: true }),
        decorationPlugin(HANDLERS),
        makeLinkActionsExtension(host),
        makeTableExtension(host),
        ...makeFrontmatterExtension(host, () => docState.relationships),
        ...makeCodeFenceExtension({
          document,
          onCopy: (source, language) => {
            host.bus.publish("clipboard.write", {
              text: source,
              label: `${language || "code"} block`,
            });
            return true;
          },
        }),
        makeMermaidExtension(host),
        ...detailsExtension(host),
        drawSelection(),
        ...(secondarySurface ? [history()] : []),
        // List Enter must win over defaultKeymap for continuation and
        // renumbering. Replacement previews expose their
        // source only through the visible Edit button.
        Prec.high(keymap.of(listKeymap)),
        keymap.of([
          ...(secondarySurface
            ? historyKeymap
            : [
                // Ordinary Markdown still delegates undo to its TextDocument.
                {
                  key: "Mod-z",
                  run: () => (api.postMessage({ type: "undo" }), true),
                },
                {
                  key: "Mod-y",
                  mac: "Mod-Shift-z",
                  run: () => (api.postMessage({ type: "redo" }), true),
                },
                {
                  key: "Mod-Shift-z",
                  run: () => (api.postMessage({ type: "redo" }), true),
                },
              ]),
          {
            key: "Mod-s",
            run: () => {
              if (secondarySurface) commitDraft("explicit");
              else api.postMessage({ type: "save" });
              return true;
            },
          },
          ...(!secondarySurface
            ? [
                {
                  key: "Mod-Shift-/",
                  run: (editor) => {
                    const { anchor, head } = editor.state.selection.main;
                    if (anchor === head) return false;
                    api.postMessage({ type: "selection.link", anchor, head });
                    return true;
                  },
                },
                {
                  key: "Mod-Alt-l",
                  run: (editor) => {
                    const { anchor, head } = editor.state.selection.main;
                    if (anchor === head) return false;
                    api.postMessage({ type: "selection.link", anchor, head });
                    return true;
                  },
                },
              ]
            : []),
          ...defaultKeymap,
        ]),
        EditorView.lineWrapping, // a note wraps, never scrolls sideways
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged &&
            !update.transactions.some((tr) => tr.annotation(remote))
          ) {
            if (secondarySurface) {
              draft.edit(update.state.doc.toString());
              reflectSaveState();
              api.postMessage({ type: "draft.state", dirty: draft.dirty });
            } else postEdit(update);
          }
          if (update.selectionSet || update.docChanged) {
            const { anchor, head } = update.state.selection.main;
            api.setState({ anchor, head, path: docState.relativePath });
            if (!secondarySurface)
              api.postMessage({ type: "selection", anchor, head });
          }
        }),
      ],
    }),
  });
  wirePreviewSelection(editor, document);
  return editor;
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  switch (msg.type) {
    case "selection.request": {
      const { anchor, head } = view?.state.selection.main ?? {
        anchor: 0,
        head: 0,
      };
      api.postMessage({
        type: "selection.snapshot",
        requestId: msg.requestId,
        anchor,
        head,
      });
      break;
    }
    case "init": {
      docState.relativePath = msg.relativePath;
      docState.generation = msg.generation;
      docState.placeholder = secondarySurface && Boolean(msg.placeholder);
      docState.relationships =
        secondarySurface && Array.isArray(msg.relationships)
          ? msg.relationships
          : [];
      draft.hydrate(msg.text, msg.generation, { discardLocal: true });
      reflectSaveState();
      view?.destroy();
      view = makeEditor(msg.text);
      const requested = msg.selection;
      const saved = api.getState();
      const selection =
        requested ?? (saved?.path === msg.relativePath ? saved : null);
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
      requestAnimationFrame(() => view?.focus());
      break;
    }
    case "external": {
      if (!view) return;
      if (secondarySurface && draft.dirty) {
        api.postMessage({ type: "draft.externalConflict" });
        return;
      }
      docState.generation = msg.generation;
      view.dispatch({
        changes: msg.changes,
        annotations: [remote.of(true)],
      });
      if (secondarySurface)
        draft.hydrate(view.state.doc.toString(), msg.generation);
      reflectSaveState();
      break;
    }
    case "reset": {
      if (!view) return;
      docState.generation = msg.generation;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: msg.text },
        annotations: [remote.of(true)],
      });
      if (secondarySurface)
        draft.hydrate(msg.text, msg.generation, { discardLocal: true });
      reflectSaveState();
      break;
    }
    case "relationships": {
      if (!secondarySurface || !view) return;
      docState.relationships = Array.isArray(msg.relationships)
        ? msg.relationships
        : [];
      view.dispatch({
        effects: setNoteRelationships.of(docState.relationships),
      });
      break;
    }
    case "committed": {
      if (!view) return;
      docState.generation = msg.generation;
      draft.acknowledge(msg);
      reflectSaveState();
      break;
    }
    case "paneState": {
      document.title = msg.title;
      docState.placeholder = secondarySurface && Boolean(msg.hasPlaceholder);
      document.body.dataset.placeholder = String(docState.placeholder);
      reflectSaveState();
      const filename = document.getElementById("pane-filename");
      if (filename) filename.textContent = msg.title || "Linked Note";
      const breadcrumb = document.getElementById("pane-breadcrumb");
      if (breadcrumb) breadcrumb.textContent = msg.breadcrumb || "Workspace";
      const pin = document.getElementById("pane-pin");
      if (pin) {
        pin.setAttribute("aria-pressed", String(Boolean(msg.pinned)));
        pin.setAttribute("aria-label", msg.pinned ? "Unpin note" : "Pin note");
        pin.disabled = !msg.canPin;
      }
      const status = document.getElementById("pane-status");
      if (status) status.textContent = msg.status || "";
      const target = document.getElementById("pane-target");
      if (target) {
        target.hidden = !msg.canOpenTarget;
        target.disabled = !msg.canOpenTarget || Boolean(msg.actionPending);
      }
      const clear = document.getElementById("pane-clear");
      if (clear) {
        clear.hidden = !msg.canTrash;
        clear.disabled = !msg.canTrash || Boolean(msg.actionPending);
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
document.addEventListener("keydown", (event) => {
  if (
    !secondarySurface ||
    event.defaultPrevented ||
    !(event.ctrlKey || event.metaKey) ||
    event.key.toLowerCase() !== "s"
  )
    return;
  event.preventDefault();
  commitDraft("explicit");
});
api.postMessage({ type: "ready" });
