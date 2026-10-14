import { resourceReadOnly } from "../notes/resources.js";
import { utf8Length } from "../host-runtime.js";
// CustomTextEditorProvider for aicNotes.markdown — hosts the CM6 webview and
// owns document sync.
//
// Sync protocol (offsets are UTF-16 code units; CM6 and TextDocument
// offsetAt/positionAt agree):
//   ext → wv  init     { text, generation, relativePath }   (on webview "ready")
//   wv → ext  edit     { changes:[{from,to,insert}], generation }
//   ext → wv  external { changes, generation }   non-echo document change
//   ext → wv  reset    { text, generation }      conflict → full replace
//
// Echo suppression: an `applying` counter brackets our own applyEdit — the
// resulting onDidChangeTextDocument events are swallowed. Any OTHER document
// change (undo/redo we triggered host-side, git checkout, a split native
// editor) bumps `generation` and is broadcast as `external`. A webview edit
// carrying a stale generation was typed against pre-external content — it is
// discarded and answered with a full reset (correctness over cleverness).

import * as vscode from "vscode";
import { formatError } from "../errors.js";
import { webviewHtml } from "./webview-html.js";
import {
  openSourceAtHref,
  openExternalLink,
  openPageTarget,
  workspaceLinkUri,
} from "../notes/navigation.js";
import { openNoteDocument } from "../notes/create.js";
import { DisposableScope } from "../lifecycle.js";
import { ClipboardHost } from "../clipboard.js";

// [[target]] → note path candidates, aic LINK_RE semantics (sync.js:913):
// a *.md target is used as-is, anything else gets `.note.md`; tried both
// project-root-relative and relative to the linking note's folder
async function resolveWikiTarget(folder, fromRelPath, target) {
  const t = target
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replace(/^\.?\//, "");
  if (!t) return null;
  const fromDir = fromRelPath.includes("/")
    ? fromRelPath.slice(0, fromRelPath.lastIndexOf("/"))
    : "";
  const bases = fromDir ? [t, `${fromDir}/${t}`] : [t];
  for (const b of bases) {
    const candidate = b.endsWith(".md") ? b : `${b}.note.md`;
    const uri = workspaceLinkUri(folder, candidate);
    if (!uri) continue;
    try {
      await vscode.workspace.fs.stat(uri);
      return uri;
    } catch {
      /* try the next base */
    }
  }
  return null;
}

export class MarkdownEditorProvider {
  static register(context, ownership, choice) {
    const provider = new MarkdownEditorProvider(context, ownership, choice);
    // Retain the old viewType for persisted user associations and restored
    // tabs, but resolve it to the same main editor, never a disposable redirect.
    provider.registrations = ["aicNotes.markdown", "aicNotes.noteRedirect"].map(
      (viewType) =>
        vscode.window.registerCustomEditorProvider(viewType, provider, {
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: false,
        }),
    );
    for (const registration of provider.registrations)
      provider.scope.add(registration);
    return provider;
  }

  constructor(context, ownership, choice) {
    this.context = context;
    this.choice = choice;
    this.sessions = new Set();
    this.snapshotRequest = 0;
    this.ownership = ownership;
    this.scope = new DisposableScope();
  }

  dispose() {
    this.scope.dispose();
  }

  async resolveCustomTextEditor(document, webviewPanel) {
    if (this.scope.disposed) return;
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    // The chosen note file is also edited from the Secondary pane: one
    // surface holds the edit lease at a time. Every other Markdown file has
    // one editor. Decided when the tab opens.
    const sharedNote = Boolean(this.choice?.isNote(document.uri));
    webview.html = this._html(webview, distRoot, sharedNote);

    const state = { generation: 0, applying: 0 };
    const session = {
      document,
      panel: webviewPanel,
      editingWaiters: new Map(),
      ready: false,
      saving: false,
      scope: this.scope.child(),
    };
    session.clipboard = new ClipboardHost({
      scope: session.scope,
      clipboard: vscode.env?.clipboard,
      context: () => ({
        webview,
        identity: document.uri.toString(),
        relativePath: vscode.workspace
          .asRelativePath(document.uri, false)
          .replaceAll("\\", "/"),
        generation: state.generation,
        hasSurface: !document.isClosed,
        ready: session.ready,
        readOnly:
          resourceReadOnly(document.uri) ||
          session.saving ||
          Boolean(
            session.editSurface &&
            this.ownership.state(session.editSurface).readOnly,
          ),
      }),
    });
    this.sessions.add(session);
    const relativePath = vscode.workspace
      .asRelativePath(document.uri, false)
      .replaceAll("\\", "/");
    if (sharedNote && this.ownership) {
      session.editSurface = this.ownership.register({
        uri: () => document.uri,
        dirty: () => document.isDirty || state.applying > 0 || session.saving,
        text: () => document.getText(),
        probe: () => this.editingSnapshot(session, relativePath),
        notify: (editing) =>
          webview.postMessage({
            type: "editingState",
            relativePath,
            ...editing,
            readOnly:
              resourceReadOnly(document.uri) ||
              editing.readOnly ||
              session.saving,
          }),
      });
    }

    const sendInit = async () => {
      if (session.scope.disposed) return false;
      return webview.postMessage({
        type: "init",
        text: document.getText(),
        generation: state.generation,
        relativePath,
        resourceUri: document.uri.toString(),
        dirty: Boolean(document.isDirty),
        ...(session.editSurface
          ? this.ownership.state(session.editSurface)
          : {}),
        readOnly:
          resourceReadOnly(document.uri) ||
          Boolean(
            session.editSurface &&
            this.ownership.state(session.editSurface).readOnly,
          ),
      });
    };
    const sendReset = () => {
      if (session.scope.disposed) return;
      state.generation++;
      webview.postMessage({
        type: "reset",
        text: document.getText(),
        generation: state.generation,
      });
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (!e.contentChanges.length) return;
      if (state.applying > 0) return; // our own applyEdit echo
      state.generation++;
      webview.postMessage({
        type: "external",
        generation: state.generation,
        changes: e.contentChanges.map((c) => ({
          from: c.rangeOffset,
          to: c.rangeOffset + c.rangeLength,
          insert: c.text,
        })),
      });
    });

    let messageQueue = Promise.resolve();
    const messageSub = webview.onDidReceiveMessage((msg) => {
      if (session.scope.disposed) return;
      if (msg?.type === "clipboard.request") {
        // Clipboard IO is independent of the document edit/save FIFO.
        void session.clipboard.handle(msg, webview);
        return;
      }
      // The snapshot is an edit barrier, not a mutation. Resolve it outside the
      // FIFO so a source-open action can safely probe its own paused webview.
      if (msg.type === "editing.snapshot") {
        const resolve = session.editingWaiters.get(msg.requestId);
        session.editingWaiters.delete(msg.requestId);
        resolve?.({ text: String(msg.text ?? ""), dirty: Boolean(msg.dirty) });
        return;
      }
      messageQueue = messageQueue.then(async () => {
        if (session.scope.disposed) return;
        try {
          switch (msg.type) {
            case "ready":
              session.ready = true;
              if (webviewPanel.active && session.editSurface)
                await this.ownership.activate(session.editSurface);
              await sendInit();
              break;
            case "editing.request":
              if (session.editSurface && msg.relativePath === relativePath)
                await this.ownership.activate(session.editSurface);
              break;
            case "edit": {
              if (resourceReadOnly(document.uri)) {
                sendReset();
                return;
              }
              if (
                session.editSurface &&
                !this.ownership.accepts(session.editSurface, msg.lease)
              ) {
                webview.postMessage({
                  type: "editingRejected",
                  relativePath,
                  message:
                    "Changes kept here. Finish saving the note in its other editor before continuing.",
                });
                return;
              }
              if (msg.generation !== state.generation) {
                // typed against pre-external content — drop it, resync
                sendReset();
                vscode.window.setStatusBarMessage(
                  "AIC Notes: concurrent change — editor resynced",
                  3000,
                );
                return;
              }
              const edit = new vscode.WorkspaceEdit();
              for (const c of msg.changes) {
                edit.replace(
                  document.uri,
                  new vscode.Range(
                    document.positionAt(c.from),
                    document.positionAt(c.to),
                  ),
                  c.insert,
                );
              }
              state.applying++;
              let ok;
              try {
                ok = await vscode.workspace.applyEdit(edit);
              } finally {
                state.applying--;
              }
              if (!ok) sendReset();
              break;
            }
            case "undo":
            case "redo":
              if (
                session.editSurface &&
                !this.ownership.accepts(session.editSurface, msg.lease)
              )
                break;
              // the resulting change is a NON-echo document event → broadcast
              // back to the webview as `external` (it did not apply it locally)
              await vscode.commands.executeCommand(msg.type);
              break;
            case "save": {
              let saved = false;
              const acknowledge = () => {
                if (!session.scope.disposed && msg.requestId != null)
                  webview.postMessage({
                    type: "primary.saved",
                    relativePath,
                    requestId: msg.requestId,
                    generation: state.generation,
                    text: document.getText(),
                    saved,
                  });
              };
              if (resourceReadOnly(document.uri)) {
                acknowledge();
                break;
              }
              if (
                (msg.relativePath && msg.relativePath !== relativePath) ||
                (msg.generation != null && msg.generation !== state.generation)
              ) {
                acknowledge();
                break;
              }
              if (
                session.editSurface &&
                !this.ownership.accepts(session.editSurface, msg.lease)
              ) {
                webview.postMessage({
                  type: "editingRejected",
                  relativePath,
                  message:
                    "Read-only here. Save the note in its active editor first.",
                });
                acknowledge();
                break;
              }
              if (session.saving) {
                acknowledge();
                break;
              }
              session.saving = true;
              try {
                if (!session.scope.disposed) {
                  if (
                    !document.isUntitled &&
                    document.uri.scheme !== "untitled"
                  ) {
                    try {
                      await vscode.workspace.fs.stat(document.uri);
                    } catch {
                      vscode.window.showErrorMessage(
                        "AIC Notes — File was deleted or is unavailable. Your draft remains in the editor; restore the file before saving.",
                      );
                      break;
                    }
                  }
                  if (
                    session.scope.disposed ||
                    (session.editSurface &&
                      !this.ownership.accepts(session.editSurface, msg.lease))
                  )
                    break;
                  const beforeSave = {
                    text: document.getText(),
                    version: document.version,
                  };
                  session.savedSnapshot = null;
                  const accepted = await document.save();
                  // onDidSave captures formatter/save-participant output. A
                  // subsequent edit must never inherit that older save ACK.
                  const written = session.savedSnapshot ?? beforeSave;
                  saved =
                    accepted === true &&
                    !document.isDirty &&
                    document.getText() === written.text &&
                    document.version === written.version;
                }
              } finally {
                session.saving = false;
                acknowledge();
                if (!session.scope.disposed && session.editSurface)
                  void this.ownership.changed(session.editSurface);
                else if (!session.scope.disposed && sharedNote)
                  webview.postMessage({
                    type: "editingState",
                    relativePath,
                    readOnly: resourceReadOnly(document.uri),
                  });
              }
              break;
            }
            case "page.openTarget":
              await openPageTarget(msg.target);
              break;
            case "bus":
              await this._routeBus(msg, document, folder, relativePath);
              break;
            case "toast": {
              const m = msg.message;
              vscode.window.showWarningMessage(
                `AIC Notes — ${typeof m === "string" ? m : formatError({ structured: m })}`,
              );
              break;
            }
            case "diagnostic":
              console.warn("aic-notes webview:", msg.key, msg.value);
              break;
          }
        } catch (e) {
          vscode.window.showErrorMessage(`AIC Notes — ${formatError(e)}`);
        }
      });
      return messageQueue;
    });

    const visibilitySub = webviewPanel.onDidChangeViewState?.(() => {
      if (webviewPanel.active) {
        if (session.editSurface)
          void this.ownership.activate(session.editSurface);
        void sendInit();
      }
    });
    const savedSub = vscode.workspace.onDidSaveTextDocument?.((saved) => {
      if (saved.uri.toString() !== document.uri.toString()) return;
      if (session.saving)
        session.savedSnapshot = {
          text: document.getText(),
          version: document.version,
        };
      if (session.editSurface) void this.ownership.changed(session.editSurface);
      if (!session.scope.disposed)
        webview.postMessage({
          type: "primary.saveState",
          relativePath,
          text: document.getText(),
        });
    });

    for (const disposable of [changeSub, messageSub, visibilitySub, savedSub])
      session.scope.add(disposable);
    session.scope.defer(() => {
      if (session.editSurface) this.ownership.dispose(session.editSurface);
      for (const resolve of session.editingWaiters.values()) resolve(null);
      session.editingWaiters.clear();
      this.sessions.delete(session);
    });
    session.scope.add(webviewPanel.onDidDispose(() => session.scope.dispose()));
  }

  editingSnapshot(session, relativePath, timeoutMs = 1500) {
    if (session.scope.disposed) return Promise.resolve(null);
    if (!session.ready)
      return Promise.resolve({
        text: session.document.getText(),
        dirty: session.document.isDirty,
      });
    const requestId = `main-${++this.snapshotRequest}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        session.editingWaiters.delete(requestId);
        resolve(null);
      }, timeoutMs);
      session.editingWaiters.set(requestId, (snapshot) => {
        clearTimeout(timeout);
        resolve(snapshot);
      });
      void session.panel.webview
        .postMessage({ type: "editing.probe", requestId, relativePath })
        .then(
          (sent) => {
            if (!sent) {
              session.editingWaiters.get(requestId)?.(null);
              session.editingWaiters.delete(requestId);
            }
          },
          () => {
            session.editingWaiters.get(requestId)?.(null);
            session.editingWaiters.delete(requestId);
          },
        );
    });
  }

  async _routeBus(msg, document, folder, relativePath) {
    const { topic, payload } = msg;
    if (topic === "clipboard.write") {
      const text = typeof payload?.text === "string" ? payload.text : "";
      if (text.length > 2 * 1024 * 1024 || utf8Length(text) > 2 * 1024 * 1024) {
        vscode.window.showWarningMessage(
          "AIC Notes — clipboard payload exceeds 2 MiB",
        );
        return;
      }
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(
        `AIC Notes: copied ${String(payload?.label ?? "source")}`,
        2000,
      );
      return;
    }
    if (topic === "link.external") {
      await openExternalLink(payload?.url);
      return;
    }
    if (topic === "file.open") {
      if (!folder || !payload?.path) return;
      const uri = workspaceLinkUri(folder, payload.path);
      if (!uri) return;
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        vscode.window.showErrorMessage(
          `AIC Notes — file_not_found: ${payload.path} — fix: check the link target`,
        );
        return;
      }
      if (uri.path.endsWith(".note.md")) {
        await openNoteDocument(uri);
      } else {
        await openSourceAtHref(uri, payload?.href ?? "");
      }
      return;
    }
    if (topic === "wiki.open") {
      if (!folder) return;
      const uri = await resolveWikiTarget(
        folder,
        relativePath,
        String(payload?.target ?? ""),
      );
      if (!uri) {
        vscode.window.showErrorMessage(
          `AIC Notes — wiki_link_unresolved: [[${payload?.target}]] matches no note — fix: create the note or correct the link`,
        );
        return;
      }
      await openNoteDocument(uri);
    }
  }

  _html(webview, distRoot, isNote) {
    return webviewHtml(
      webview,
      distRoot,
      "main.js",
      '<div id="editor"></div>' +
        (isNote
          ? '<footer id="document-actions" aria-label="Note actions"><span id="editing-status" role="status" aria-live="polite"></span></footer>'
          : ""),
      "aic-main-note-surface",
    );
  }
}
