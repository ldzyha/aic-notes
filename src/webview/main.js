// The markdown editor webview — the FULL aic markdown session (owner
// 2026-07-03, reversing the same-day minimal directive: claim every *.md and
// carry the complete custom syntax): the reveal-rule handler set (headings,
// emphasis, inline code, lists + task boxes, direct link actions, blockquote/hr/
// strikethrough, code fences), nested fenced-code highlighting (lazy chunks),
// and structured previews — the table grid, shared Properties/Security cards,
// and in-place Mermaid.
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
  ViewPlugin,
  keymap,
  drawSelection,
  placeholder,
} from "@codemirror/view";
import { EditorState, Annotation, Compartment } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";

import { HANDLERS, decorationPlugin } from "../../vendor/markdown/session.js";
import { makeLinkActionsExtension } from "../../vendor/markdown/link-actions.js";
import { listKeymap } from "../../vendor/markdown/handlers/list.js";
import { makeTableExtension } from "../../vendor/markdown/handlers/table.js";
import { makeCodeFenceExtension } from "../../vendor/markdown/handlers/code-fence.js";
import { makeCalloutExtension } from "../../vendor/aic-editor-core/callout-decorations.js";
import { makeMermaidExtension } from "../../vendor/markdown/mermaid.js";
import { MARKDOWN_CSS } from "../../vendor/markdown/styles.js";
import { makeFencedMarkdown } from "./fenced-local.js";
import { darkHighlight } from "./highlight.js";
import { makeHost, makeClipboardClient } from "./host-shim.js";
import { detailsExtension } from "./details.js";
import { upsertLinkedCodeReference } from "../notes/selection-model.js";
import {
  SecondaryDraft,
  secondarySaveState,
  minimalTextChange,
} from "./secondary-draft.js";
import { wirePreviewSelection } from "../../vendor/aic-editor-core/structured-preview.js";
import { editorIndentation } from "../../vendor/aic-editor-core/indentation.js";
import { markdownFormatting } from "../../vendor/aic-editor-core/formatting.js";
import {
  makeSecurityBlockExtension,
  makePropertiesBlockExtension,
  setPropertyRelationships,
} from "../../vendor/aic-editor-core/security-block.js";
import { makeSecurityImportExtension } from "../../vendor/aic-editor-core/security-import-extension.js";
import {
  isSaveAction,
  wireSaveBoundary,
} from "../../vendor/aic-editor-core/save-boundary.js";
import { createSourceModeController } from "../../vendor/aic-editor-core/source-mode.js";
import { createEditorHelp } from "../../vendor/aic-editor-core/editor-help.js";
import { PrimarySave } from "./primary-save.js";
import {
  SLASH_SNIPPET_PLACEHOLDER,
  slashSnippetExtension,
} from "../../vendor/aic-editor-core/slash-snippets.js";
import ICONS_CSS from "../../vendor/aic-editor-core/icons.css";
import UI_SYSTEM_CSS from "../../vendor/aic-editor-core/ui-system.css";
import MERMAID_VIEWPORT_CSS from "../../vendor/aic-editor-core/mermaid-viewport.css";
import SLASH_SNIPPETS_CSS from "../../vendor/aic-editor-core/slash-snippets.css";
import PREVIEW_LAYOUT_CSS from "../../vendor/aic-editor-core/preview-layout.css";
import DIAGRAM_BUILDER_CSS from "../../vendor/aic-editor-core/diagram-builder.css";
import DIAGRAM_PALETTE_CSS from "../../vendor/aic-editor-core/diagram-palette.css";
import DIAGRAM_SESSION_CSS from "../../vendor/aic-editor-core/diagram-session.css";
import SECURITY_BLOCK_CSS from "../../vendor/aic-editor-core/security-block.css";
import SECURITY_IMPORT_CSS from "../../vendor/aic-editor-core/security-import-extension.css";
import THEME_CSS from "./theme.css";

const api = acquireVsCodeApi();
const remote = Annotation.define();
const secondarySurface = document.body.classList.contains(
  "aic-secondary-surface",
);
if (secondarySurface)
  document.documentElement.classList.add("aic-secondary-shell");

const docState = {
  relativePath: "",
  generation: 0,
  placeholder: false,
  relationships: [],
  hasSurface: false,
  readOnly: false,
  lease: undefined,
  editingConflict: false,
  canTrash: false,
  actionPending: false,
};
const draft = new SecondaryDraft();
const primarySave = new PrimarySave();
const host = makeHost(api, docState);
const clipboard = makeClipboardClient(api, docState);
let paneNotice = "";
const saveWaiters = new Set();

function finishSaveRequests(saved) {
  const active = secondarySurface ? draft : primarySave;
  if (saved && (active.pending || (active.queued && active.dirty))) return;
  for (const waiter of saveWaiters) {
    saveWaiters.delete(waiter);
    waiter.resolve(
      Boolean(saved && waiter.path === docState.relativePath && !active.dirty),
    );
  }
}

function saveCurrentDraft() {
  const active = secondarySurface ? draft : primarySave;
  if (!view || docState.readOnly || !docState.hasSurface)
    return Promise.resolve(false);
  if (!active.dirty && !active.pending) return Promise.resolve(true);
  return new Promise((resolve) => {
    saveWaiters.add({ path: docState.relativePath, resolve });
    commitDraft("explicit");
  });
}

function reflectSaveState() {
  const active = secondarySurface ? draft : primarySave;
  const state = secondarySaveState({
    dirty: active.dirty,
    pending: active.pending,
    placeholder: docState.placeholder,
    hasSurface: docState.hasSurface,
  });
  document.body.dataset.saveState = state;
  const label =
    paneNotice ||
    (docState.readOnly
      ? "Read-only here · finish saving the note in its other editor"
      : "") ||
    (state === "dirty"
      ? active.pending
        ? "Saving note"
        : "Unsaved changes. Save or leave the editor to save."
      : state === "placeholder"
        ? "Note placeholder. Edit and press Ctrl+S to create."
        : state === "saved"
          ? "Note saved"
          : "No note selected");
  const indicator = document.getElementById("pane-save-indicator");
  if (indicator) {
    indicator.hidden = state !== "dirty";
    indicator.setAttribute("aria-label", label);
  }
  const status = document.getElementById("pane-status");
  if (status && status.textContent !== label) status.textContent = label;
  const save = document.getElementById("aic-save");
  if (save) {
    save.hidden = state !== "dirty";
    save.disabled = docState.readOnly || Boolean(active.pending);
    save.title = label;
  }
}

function postDraftState() {
  api.postMessage({
    type: "draft.state",
    dirty: draft.dirty,
    pending: draft.pending,
    relativePath: docState.relativePath,
  });
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
  UI_SYSTEM_CSS,
  MARKDOWN_CSS,
  ICONS_CSS,
  MERMAID_VIEWPORT_CSS,
  SLASH_SNIPPETS_CSS,
  PREVIEW_LAYOUT_CSS,
  DIAGRAM_BUILDER_CSS,
  DIAGRAM_PALETTE_CSS,
  DIAGRAM_SESSION_CSS,
  SECURITY_BLOCK_CSS,
  SECURITY_IMPORT_CSS,
]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

let view = null;
const accessCompartment = new Compartment();
const sourceMode = createSourceModeController();
function accessExtension() {
  return [
    EditorState.readOnly.of(docState.readOnly),
    EditorView.editable.of(!docState.readOnly),
  ];
}
function reflectEditingState() {
  const text = docState.editingConflict
    ? "Local changes kept here. Copy them before reopening this note."
    : docState.readOnly
      ? "Read-only here · finish saving the note in its other editor"
      : "";
  const status = document.getElementById("editing-status");
  if (status) status.textContent = text;
  if (secondarySurface) reflectSaveState();
  const clear = document.getElementById("pane-clear");
  if (clear)
    clear.disabled =
      docState.readOnly || !docState.canTrash || docState.actionPending;
  document.body.dataset.readOnly = String(docState.readOnly);
}
function setEditingState(readOnly, lease = docState.lease) {
  const changed =
    docState.readOnly !== Boolean(readOnly || docState.editingConflict);
  docState.readOnly = Boolean(readOnly || docState.editingConflict);
  if (docState.readOnly) clipboard.cancel();
  if (!docState.readOnly && paneNotice.startsWith("Read-only here"))
    paneNotice = "";
  docState.lease = lease;
  if (changed && view)
    view.dispatch({
      effects: accessCompartment.reconfigure(accessExtension()),
    });
  reflectEditingState();
  reflectSaveState();
  if (!docState.readOnly) drainRequestedSave();
}

function wireEditorHelp(actionBar) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cm-aic-icon-button aic-pane-icon";
  trigger.textContent = "?";
  trigger.title = "Editor guide";
  trigger.setAttribute("aria-label", "Open editor guide");
  trigger.setAttribute("aria-controls", "aic-editor-help");
  trigger.setAttribute("aria-expanded", "false");

  const popover = createEditorHelp(document, { host: "vscode" });
  popover.id = "aic-editor-help";
  popover.setAttribute("popover", "auto");
  const nativePopover = typeof popover.togglePopover === "function";
  if (!nativePopover) popover.hidden = true;

  const controller = new AbortController();
  const reflect = () => {
    let open = !popover.hidden;
    if (nativePopover) {
      try {
        open = popover.matches(":popover-open");
      } catch {
        open = false;
      }
    }
    trigger.setAttribute("aria-expanded", String(open));
  };
  trigger.addEventListener(
    "click",
    () => {
      if (nativePopover) popover.togglePopover();
      else {
        popover.hidden = !popover.hidden;
        reflect();
      }
    },
    { signal: controller.signal },
  );
  popover.addEventListener("toggle", reflect, { signal: controller.signal });
  document.addEventListener(
    "keydown",
    (event) => {
      if (!nativePopover && event.key === "Escape" && !popover.hidden) {
        popover.hidden = true;
        reflect();
        trigger.focus();
      }
    },
    { signal: controller.signal },
  );
  window.addEventListener(
    "unload",
    () => {
      controller.abort();
      popover.remove();
    },
    { once: true },
  );

  document.body.append(popover);
  actionBar.append(trigger);
}

function wirePaneControls() {
  let footer = document.getElementById(
    secondarySurface ? "secondary-footer" : "document-actions",
  );
  if (!footer) {
    footer = document.createElement("footer");
    footer.id = "document-actions";
    document.body.append(footer);
  }
  if (!secondarySurface) {
    document.body.classList.add("aic-main-note-surface");
    const status = document.createElement("span");
    status.id = "pane-status";
    status.className = "aic-visually-hidden";
    status.setAttribute("role", "status");
    footer.append(status);
  }
  const save = document.createElement("button");
  save.id = "aic-save";
  save.type = "button";
  save.className = "cm-aic-icon-button aic-pane-icon";
  save.dataset.aicIcon = "save";
  save.setAttribute("aria-label", "Save note");
  save.hidden = true;
  save.addEventListener("click", () => commitDraft("explicit"));
  footer.prepend(save);
  footer.prepend(
    sourceMode.createButton(document, () => view, "aic-pane-icon"),
  );
  wireEditorHelp(footer);
  if (!secondarySurface) return;
  document
    .getElementById("pane-pin")
    ?.addEventListener("click", () => api.postMessage({ type: "pane.pin" }));
  document.getElementById("pane-target")?.addEventListener("click", () => {
    const path = docState.relativePath;
    void saveCurrentDraft().then((saved) => {
      if (saved && path === docState.relativePath)
        api.postMessage({ type: "pane.target" });
    });
  });
  document
    .getElementById("pane-clear")
    ?.addEventListener("click", () =>
      api.postMessage({ type: "pane.clear", lease: docState.lease }),
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
    api.postMessage({
      type: "edit",
      changes,
      generation: docState.generation,
      lease: docState.lease,
    });
}

function commitDraft(reason) {
  if (!view || !docState.hasSurface) return;
  const active = secondarySurface ? draft : primarySave;
  // A host save can briefly pause input for a metadata barrier. Retain a
  // newer already-requested draft while that save is still acknowledged.
  if (docState.readOnly && !active.pending) return;
  const commit = active.request(reason);
  if (!commit) return;
  paneNotice = "";
  reflectSaveState();
  if (secondarySurface) postDraftState();
  api.postMessage({
    type: secondarySurface ? "commit" : "save",
    ...commit,
    generation: docState.generation,
    lease: docState.lease,
  });
}

function drainRequestedSave() {
  if (docState.readOnly) return;
  const active = secondarySurface ? draft : primarySave;
  if (active.takeQueued()) commitDraft("explicit");
}

function makeEditor(text) {
  const parent = document.getElementById("editor");
  parent.innerHTML = "";
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        ViewPlugin.define((editor) => ({
          destroy: wirePreviewSelection(editor, document),
        })),
        accessCompartment.of(accessExtension()),
        EditorView.domEventHandlers({
          focus() {
            api.postMessage({
              type: "editing.request",
              relativePath: docState.relativePath,
            });
          },
          mousedown() {
            api.postMessage({
              type: "editing.request",
              relativePath: docState.relativePath,
            });
          },
        }),
        editorIndentation({ continueList: listKeymap[0].run }),
        markdownFormatting(),
        langCompartment.of(fencedLang()),
        placeholder(SLASH_SNIPPET_PLACEHOLDER),
        slashSnippetExtension(),
        // colors nested fenced-code tokens; markdown structure styling is
        // owned by the handler classes (theme.css bumps their specificity)
        syntaxHighlighting(darkHighlight, { fallback: true }),
        sourceMode.extension([
          decorationPlugin(HANDLERS),
          makeCalloutExtension(),
          makeLinkActionsExtension(host),
          makeTableExtension(host),
          makePropertiesBlockExtension({
            document,
            initialRelationships: () => docState.relationships,
            onRelationshipOpen: (path) =>
              host.bus.publish("note.open", { path }),
            onReadClipboard: () => clipboard.readText(),
            onCopy: (source) => clipboard.writeText(source),
            onOpen: (url) => host.bus.publish("link.external", { url }),
          }),
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
          makeSecurityBlockExtension({
            document,
            onReadClipboard: () => clipboard.readText(),
            onCopy: (source) => clipboard.writeText(source),
            onOpen: (url) => {
              host.bus.publish("link.external", { url });
            },
          }),
          makeSecurityImportExtension({ onSave: saveCurrentDraft }),
          makeMermaidExtension(host),
          ...detailsExtension(host),
        ]),
        drawSelection(),
        ...(secondarySurface ? [history()] : []),
        keymap.of([
          ...(secondarySurface
            ? historyKeymap
            : [
                // Ordinary Markdown still delegates undo to its TextDocument.
                {
                  key: "Mod-z",
                  run: () => {
                    if (!docState.readOnly)
                      api.postMessage({ type: "undo", lease: docState.lease });
                    return true;
                  },
                },
                {
                  key: "Mod-y",
                  mac: "Mod-Shift-z",
                  run: () => {
                    if (!docState.readOnly)
                      api.postMessage({ type: "redo", lease: docState.lease });
                    return true;
                  },
                },
                {
                  key: "Mod-Shift-z",
                  run: () => {
                    if (!docState.readOnly)
                      api.postMessage({ type: "redo", lease: docState.lease });
                    return true;
                  },
                },
              ]),
          {
            key: "Mod-s",
            run: () => {
              commitDraft("explicit");
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
              paneNotice = "";
              reflectSaveState();
              postDraftState();
            } else {
              primarySave.edit(update.state.doc.toString());
              paneNotice = "";
              reflectSaveState();
              postEdit(update);
            }
            if (isSaveAction(update)) {
              const currentView = update.view;
              const path = docState.relativePath;
              queueMicrotask(() => {
                if (view === currentView && docState.relativePath === path)
                  commitDraft("explicit");
              });
            }
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
  return editor;
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (clipboard.handleMessage(msg)) return;
  switch (msg.type) {
    case "draft.saveRequest": {
      if (!secondarySurface || msg.relativePath !== docState.relativePath)
        break;
      void saveCurrentDraft().then((saved) =>
        api.postMessage({
          type: "draft.saveResult",
          requestId: msg.requestId,
          relativePath: msg.relativePath,
          saved,
        }),
      );
      break;
    }
    case "linkedCode.insert": {
      let result;
      if (
        secondarySurface &&
        view &&
        !docState.readOnly &&
        msg.relativePath === docState.relativePath &&
        msg.generation === docState.generation &&
        msg.lease === docState.lease &&
        Number.isFinite(msg.expiresAt) &&
        Date.now() <= msg.expiresAt
      ) {
        result = upsertLinkedCodeReference(
          view.state.doc.toString(),
          msg.reference,
          msg.selectedText,
        );
        view.dispatch({
          changes:
            minimalTextChange(view.state.doc.toString(), result.text) ?? [],
          selection: { anchor: result.cursor },
          scrollIntoView: true,
          userEvent: "input",
        });
        view.focus();
      }
      api.postMessage({
        type: "linkedCode.result",
        requestId: msg.requestId,
        accepted: Boolean(result),
        created: result?.created,
      });
      break;
    }
    case "editing.probe":
      if (msg.relativePath !== docState.relativePath || !view) break;
      setEditingState(true);
      api.postMessage({
        type: "editing.snapshot",
        requestId: msg.requestId,
        text: view.state.doc.toString(),
        dirty:
          docState.editingConflict ||
          (secondarySurface && (draft.dirty || draft.pending)),
      });
      break;
    case "editingState":
      if (msg.relativePath === docState.relativePath)
        setEditingState(msg.readOnly, msg.lease);
      break;
    case "editingRejected":
      if (msg.relativePath !== docState.relativePath) break;
      docState.editingConflict = true;
      setEditingState(true);
      break;
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
      finishSaveRequests(false);
      clipboard.cancel();
      if (docState.relativePath !== msg.relativePath) sourceMode.reset();
      docState.relativePath = msg.relativePath;
      docState.hasSurface = true;
      docState.editingConflict = false;
      docState.readOnly = Boolean(msg.readOnly);
      docState.lease = msg.lease;
      docState.generation = msg.generation;
      docState.placeholder = secondarySurface && Boolean(msg.placeholder);
      docState.relationships =
        secondarySurface && Array.isArray(msg.relationships)
          ? msg.relationships
          : [];
      draft.hydrate(msg.text, msg.generation, {
        discardLocal: true,
        relativePath: msg.relativePath,
      });
      primarySave.reset(msg.relativePath, msg.text, msg.dirty);
      paneNotice = "";
      reflectSaveState();
      view?.destroy();
      view = makeEditor(msg.text);
      reflectEditingState();
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
      if (docState.editingConflict) return;
      if (secondarySurface && (draft.dirty || draft.pending)) {
        api.postMessage({ type: "draft.externalConflict" });
        return;
      }
      docState.generation = msg.generation;
      clipboard.cancel();
      view.dispatch({
        changes: msg.changes,
        annotations: [remote.of(true)],
      });
      if (secondarySurface)
        draft.hydrate(view.state.doc.toString(), msg.generation);
      else primarySave.edit(view.state.doc.toString());
      reflectSaveState();
      break;
    }
    case "reset": {
      if (!view) return;
      if (docState.editingConflict) return;
      docState.generation = msg.generation;
      clipboard.cancel();
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: msg.text },
        annotations: [remote.of(true)],
      });
      if (secondarySurface)
        draft.hydrate(msg.text, msg.generation, { discardLocal: true });
      else primarySave.edit(msg.text);
      reflectSaveState();
      break;
    }
    case "relationships": {
      if (!secondarySurface || !view) return;
      docState.relationships = Array.isArray(msg.relationships)
        ? msg.relationships
        : [];
      view.dispatch({
        effects: setPropertyRelationships.of(docState.relationships),
      });
      break;
    }
    case "committed": {
      if (!secondarySurface || !view || !draft.acknowledge(msg)) return;
      docState.generation = msg.generation;
      const change = minimalTextChange(
        view.state.doc.toString(),
        draft.current,
      );
      if (change)
        view.dispatch({ changes: change, annotations: [remote.of(true)] });
      paneNotice = msg.saved
        ? ""
        : "Save failed. Your changes are kept. Press Ctrl+S to retry.";
      reflectSaveState();
      postDraftState();
      drainRequestedSave();
      finishSaveRequests(msg.saved === true);
      break;
    }
    case "primary.saved": {
      if (secondarySurface || !view || !primarySave.acknowledge(msg)) break;
      paneNotice = msg.saved
        ? ""
        : "Save failed. Your changes are kept. Use Save to retry.";
      reflectSaveState();
      drainRequestedSave();
      finishSaveRequests(msg.saved === true);
      break;
    }
    case "primary.saveState": {
      if (secondarySurface || msg.relativePath !== docState.relativePath) break;
      primarySave.externallySaved(msg.text);
      reflectSaveState();
      break;
    }
    case "paneState": {
      document.title = msg.title;
      docState.canTrash = Boolean(msg.canTrash);
      docState.actionPending = Boolean(msg.actionPending);
      docState.hasSurface = Boolean(msg.hasSurface);
      if (!docState.hasSurface) clipboard.cancel();
      docState.placeholder = secondarySurface && Boolean(msg.hasPlaceholder);
      document.body.dataset.placeholder = String(docState.placeholder);
      paneNotice = msg.status || "";
      reflectSaveState();
      const pin = document.getElementById("pane-pin");
      if (pin) {
        pin.setAttribute("aria-pressed", String(Boolean(msg.pinned)));
        pin.setAttribute("aria-label", msg.pinned ? "Unpin note" : "Pin note");
        pin.disabled = !msg.canPin;
      }
      const target = document.getElementById("pane-target");
      if (target) {
        target.hidden = !msg.canOpenTarget;
        target.disabled = !msg.canOpenTarget || Boolean(msg.actionPending);
      }
      const clear = document.getElementById("pane-clear");
      if (clear) {
        clear.hidden = !msg.canTrash;
        clear.disabled =
          docState.readOnly || !msg.canTrash || Boolean(msg.actionPending);
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
    event.defaultPrevented ||
    !(event.ctrlKey || event.metaKey) ||
    event.key.toLowerCase() !== "s"
  )
    return;
  event.preventDefault();
  commitDraft("explicit");
});
const unwireSaveBoundary = wireSaveBoundary(document.body, () =>
  commitDraft("explicit"),
);
window.addEventListener("unload", unwireSaveBoundary, { once: true });
api.postMessage({ type: "ready" });
