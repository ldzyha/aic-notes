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
import { openSourceAtHref } from "../notes/navigation.js";
import { openNoteDocument } from "../notes/create.js";
import { isNotePath } from "../secondary/model.js";
import { stampNoteProperties } from "../notes/properties.js";

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
    const uri = vscode.Uri.joinPath(folder.uri, candidate);
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
  static register(context, ownership) {
    const provider = new MarkdownEditorProvider(context, ownership);
    // Retain the old viewType for persisted user associations and restored
    // tabs, but resolve it to the same main editor, never a disposable redirect.
    provider.registrations = ["aicNotes.markdown", "aicNotes.noteRedirect"].map(
      (viewType) =>
        vscode.window.registerCustomEditorProvider(viewType, provider, {
          webviewOptions: { retainContextWhenHidden: true },
          supportsMultipleEditorsPerDocument: false,
        }),
    );
    return provider;
  }

  constructor(context, ownership) {
    this.context = context;
    this.sessions = new Set();
    this.selectionRequest = 0;
    this.ownership = ownership;
  }

  dispose() {
    for (const registration of this.registrations ?? []) registration.dispose();
    for (const session of this.sessions) {
      if (session.editSurface) this.ownership.dispose(session.editSurface);
      for (const resolve of session.editingWaiters.values()) resolve(null);
      for (const resolve of session.selectionWaiters.values()) resolve(null);
      session.selectionWaiters.clear();
    }
    this.sessions.clear();
  }

  async activeSourceSelection() {
    const session = [...this.sessions].find(({ panel }) => panel.active);
    if (!session || session.document.isClosed) return null;
    if (session.commandSelection) {
      session.commandSelection = false;
      return this._sourceSelection(session, session.selection);
    }

    const requestId = `selection-${++this.selectionRequest}`;
    const requested = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        session.selectionWaiters.delete(requestId);
        resolve(session.selection);
      }, 750);
      session.selectionWaiters.set(requestId, (selection) => {
        clearTimeout(timeout);
        resolve(selection);
      });
    });
    if (
      !(await session.panel.webview.postMessage({
        type: "selection.request",
        requestId,
      }))
    ) {
      session.selectionWaiters.get(requestId)?.(session.selection);
      session.selectionWaiters.delete(requestId);
    }
    const selection = await requested;
    return this._sourceSelection(session, selection);
  }

  _sourceSelection(session, selection) {
    if (
      !selection ||
      !Number.isInteger(selection.anchor) ||
      !Number.isInteger(selection.head) ||
      selection.anchor === selection.head
    )
      return null;
    const length = session.document.getText().length;
    const anchor = Math.max(0, Math.min(selection.anchor, length));
    const head = Math.max(0, Math.min(selection.head, length));
    if (anchor === head) return null;
    return {
      document: session.document,
      selection: new vscode.Selection(
        session.document.positionAt(anchor),
        session.document.positionAt(head),
      ),
    };
  }

  async resolveCustomTextEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webview.html = this._html(webview, distRoot, document.uri);

    const state = { generation: 0, applying: 0 };
    const session = {
      document,
      panel: webviewPanel,
      selection: null,
      selectionWaiters: new Map(),
      editingWaiters: new Map(),
      ready: false,
      saving: false,
    };
    this.sessions.add(session);
    const relativePath = vscode.workspace
      .asRelativePath(document.uri, false)
      .replaceAll("\\", "/");
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (isNotePath(document.uri.path) && this.ownership) {
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
            readOnly: editing.readOnly || session.saving,
          }),
      });
    }

    const sendInit = () =>
      webview.postMessage({
        type: "init",
        text: document.getText(),
        generation: state.generation,
        relativePath,
        ...(session.editSurface
          ? this.ownership.state(session.editSurface)
          : {}),
      });
    const sendReset = () => {
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
      // The snapshot is an edit barrier, not a mutation. Resolve it outside the
      // FIFO so a source-open action can safely probe its own paused webview.
      if (msg.type === "editing.snapshot") {
        const resolve = session.editingWaiters.get(msg.requestId);
        session.editingWaiters.delete(msg.requestId);
        resolve?.({ text: String(msg.text ?? ""), dirty: Boolean(msg.dirty) });
        return;
      }
      messageQueue = messageQueue.then(async () => {
        try {
          switch (msg.type) {
            case "ready":
              session.ready = true;
              if (webviewPanel.active && session.editSurface)
                await this.ownership.activate(session.editSurface);
              sendInit();
              break;
            case "editing.request":
              if (session.editSurface && msg.relativePath === relativePath)
                await this.ownership.activate(session.editSurface);
              break;
            case "edit": {
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
                break;
              }
              if (session.saving) break;
              session.saving = true;
              try {
                if (isNotePath(document.uri.path)) {
                  const original = document.getText();
                  // Pause the client before metadata IO. Edits made between
                  // Ctrl+S and this probe are queued behind this save; stamping
                  // their older host buffer would reset that still-local text.
                  const snapshot = session.ready
                    ? await this.editingSnapshot(session, relativePath, 250)
                    : { text: original, dirty: false };
                  if (
                    snapshot &&
                    !snapshot.dirty &&
                    snapshot.text === original &&
                    document.getText() === original
                  ) {
                    const stamped = await stampNoteProperties(
                      original,
                      document.uri,
                    );
                    // If the host changed meanwhile, skip metadata rather than
                    // resetting the source. Save keeps its normal buffer scope.
                    if (
                      document.getText() === original &&
                      stamped !== original
                    ) {
                      const edit = new vscode.WorkspaceEdit();
                      edit.replace(
                        document.uri,
                        new vscode.Range(
                          document.positionAt(0),
                          document.positionAt(original.length),
                        ),
                        stamped,
                      );
                      if (!(await vscode.workspace.applyEdit(edit))) break;
                    }
                  }
                }
                await document.save();
              } finally {
                session.saving = false;
                if (session.editSurface)
                  void this.ownership.changed(session.editSurface);
                else if (isNotePath(document.uri.path))
                  webview.postMessage({
                    type: "editingState",
                    relativePath,
                    readOnly: false,
                  });
              }
              break;
            }
            case "source.open":
              if (isNotePath(document.uri.path))
                await vscode.commands.executeCommand(
                  "aicNotes.openSource",
                  document.uri,
                );
              break;
            case "selection":
              session.selection = {
                anchor: Number(msg.anchor),
                head: Number(msg.head),
              };
              break;
            case "selection.link":
              session.selection = {
                anchor: Number(msg.anchor),
                head: Number(msg.head),
              };
              session.commandSelection = true;
              await vscode.commands.executeCommand(
                "aicNotes.linkSelectionToNote",
              );
              break;
            case "selection.snapshot": {
              const resolve = session.selectionWaiters.get(msg.requestId);
              if (!resolve) break;
              session.selectionWaiters.delete(msg.requestId);
              session.selection = {
                anchor: Number(msg.anchor),
                head: Number(msg.head),
              };
              resolve(session.selection);
              break;
            }
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
      if (webviewPanel.active && session.editSurface)
        void this.ownership.activate(session.editSurface);
    });
    const willSaveSub = vscode.workspace.onWillSaveTextDocument?.((event) => {
      if (
        event.document.uri.toString() !== document.uri.toString() ||
        event.reason !== vscode.TextDocumentSaveReason.Manual ||
        !isNotePath(document.uri.path) ||
        session.saving ||
        (session.editSurface &&
          this.ownership.state(session.editSurface).readOnly)
      )
        return;
      const original = document.getText();
      session.saving = true;
      event.waitUntil(
        (async () => {
          // Native Save can overtake an optimistic webview edit. Briefly pause
          // and compare the client before changing note metadata.
          const snapshot = session.ready
            ? await this.editingSnapshot(session, relativePath, 250)
            : { text: original, dirty: false };
          if (!snapshot || snapshot.dirty || snapshot.text !== original)
            return [];
          // A failed/slow file stat must not leave the editor paused after
          // VS Code abandons its save participants. A late result only builds
          // text and is ignored; it cannot apply metadata after this barrier.
          let timeout;
          const stamped = await Promise.race([
            stampNoteProperties(original, document.uri),
            new Promise((resolve) => {
              timeout = setTimeout(() => resolve(null), 750);
            }),
          ]).finally(() => clearTimeout(timeout));
          if (
            stamped === null ||
            document.getText() !== original ||
            stamped === original ||
            (session.editSurface &&
              this.ownership.state(session.editSurface).readOnly)
          )
            return [];
          // Apply while paused and await the document change/echo before
          // releasing the client. Returning a full-document TextEdit here
          // would defer application until AFTER finally resumes input.
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(
              document.positionAt(0),
              document.positionAt(original.length),
            ),
            stamped,
          );
          await vscode.workspace.applyEdit(edit);
          return [];
        })()
          .catch(() => [])
          .finally(() => {
            session.saving = false;
            if (session.editSurface) this.ownership.notify();
            else
              webview.postMessage({
                type: "editingState",
                relativePath,
                readOnly: false,
              });
          }),
      );
    });
    const savedSub = vscode.workspace.onDidSaveTextDocument?.((saved) => {
      if (
        saved.uri.toString() === document.uri.toString() &&
        session.editSurface
      )
        void this.ownership.changed(session.editSurface);
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
      visibilitySub?.dispose();
      willSaveSub?.dispose();
      savedSub?.dispose();
      if (session.editSurface) this.ownership.dispose(session.editSurface);
      for (const resolve of session.editingWaiters.values()) resolve(null);
      session.editingWaiters.clear();
      this.sessions.delete(session);
      for (const resolve of session.selectionWaiters.values()) resolve(null);
      session.selectionWaiters.clear();
    });
  }

  editingSnapshot(session, relativePath, timeoutMs = 1500) {
    if (!session.ready)
      return Promise.resolve({
        text: session.document.getText(),
        dirty: session.document.isDirty,
      });
    const requestId = `main-${++this.selectionRequest}`;
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
      if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
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
      const url = String(payload?.url ?? "");
      if (!/^(?:https?:|mailto:|tel:|vscode:)/i.test(url)) {
        vscode.window.showWarningMessage(
          `AIC Notes — refusing to open non-http(s) link: ${url}`,
        );
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    if (topic === "file.open") {
      if (!folder || !payload?.path) return;
      const uri = vscode.Uri.joinPath(folder.uri, payload.path);
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

  _html(webview, distRoot, uri) {
    const isNote = isNotePath(uri?.path);
    return webviewHtml(
      webview,
      distRoot,
      "main.js",
      '<div id="editor"></div>' +
        (isNote
          ? '<footer id="document-actions" aria-label="Note actions"><button id="document-source" class="cm-aic-icon-button" type="button" data-aic-icon="source" aria-label="Open source"></button><span id="editing-status" role="status" aria-live="polite"></span></footer>'
          : ""),
      isNote ? "aic-main-note-surface" : "",
    );
  }
}
