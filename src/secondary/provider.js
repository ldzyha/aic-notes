import * as vscode from "vscode";
import * as path from "node:path";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import { applyTextChanges, linkedNotePath, isNotePath } from "./model.js";
import { resolveTarget } from "../notes/target.js";
import { fileNotePlaceholderForUri } from "../notes/create.js";
import { openSourceAtHref } from "../notes/navigation.js";
import { clearNoteContent } from "./note-actions.js";
import { deleteNotes } from "../notes/delete.js";
import { CoalescingQueue, mergeSyncRequests } from "../sync/coalescing-queue.js";

export const SECONDARY_VIEW_ID = "aicNotes.secondary";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function uriFromTab(tab) {
  return tab?.input?.uri ?? tab?.input?.modified ?? undefined;
}

export class SecondaryNotePane {
  static register(context, syncService) {
    const pane = new SecondaryNotePane(context, syncService);
    context.subscriptions.push(
      pane,
      vscode.window.registerWebviewViewProvider(SECONDARY_VIEW_ID, pane, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.window.registerCustomEditorProvider("aicNotes.noteRedirect", {
        async resolveCustomTextEditor(document, panel) {
          await pane.open(document.uri, { pin: true, reveal: true });
          panel.dispose();
        },
      }),
      vscode.window.onDidChangeActiveTextEditor(() => pane.followActive()),
      vscode.window.tabGroups.onDidChangeTabs(() => pane.routeNoteTabs()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => pane.followActive()),
      vscode.workspace.onDidChangeTextDocument((event) => pane.onDocumentChanged(event)),
      vscode.workspace.onDidSaveTextDocument((document) => {
        pane.onDocumentSaved(document).catch((error) => pane.reportSyncError(error));
      }),
      vscode.workspace.onDidCloseTextDocument((document) => pane.onDocumentClosed(document)),
    );
    queueMicrotask(() => pane.routeNoteTabs());
    return pane;
  }

  constructor(context, syncService) {
    this.context = context;
    this.syncService = syncService;
    this.view = undefined;
    this.document = undefined;
    this.documentUri = undefined;
    this.sourceUri = undefined;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    this.pinned = false;
    this.ready = false;
    this.generation = 0;
    this.applying = 0;
    this.editQueue = Promise.resolve();
    this.pendingViewState = undefined;
    this.creating = false;
    this.readOnly = false;
    this.authConnected = false;
    this.authReconnect = false;
    this.authPending = false;
    this.actionPending = false;
    this.disposables = [];
    this.routingTabs = false;
    this.syncRequests = new CoalescingQueue(
      (_key, request) => this.performSync(request.uri, request),
      mergeSyncRequests,
    );
    this.suppressedSaveSync = new Set();
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  async resolveWebviewView(view) {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    view.webview.html = webviewHtml(
      view.webview,
      distRoot,
      "main.js",
      `<section id="secondary-controls" aria-label="Linked note context">
        <div class="aic-pane-context">
          <strong id="pane-filename"></strong>
          <span id="pane-breadcrumb" class="aic-pane-breadcrumb"></span>
        </div>
        <span id="pane-status" role="status"></span>
      </section>
      <div id="pane-empty" class="aic-pane-empty">
        <strong>Open a workspace file</strong>
        <span id="pane-empty-detail">Its note or editable placeholder will appear here.</span>
      </div>
      <div id="editor"></div>
      <footer id="secondary-footer" aria-label="Linked note actions">
        <button id="pane-auth" class="aic-pane-icon" type="button" title="Log in to Standard Notes" aria-label="Log in to Standard Notes">
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M8.5 3.5H5.75A1.75 1.75 0 0 0 4 5.25v9.5c0 .97.78 1.75 1.75 1.75H8.5M11.5 6.5 15 10l-3.5 3.5M7 10h8"/></svg>
        </button>
        <button id="pane-target" class="aic-pane-icon" type="button" title="Open source" aria-label="Open source" hidden>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.25 6-4 4 4 4M12.75 6l4 4-4 4M11.25 3.75l-2.5 12.5"/></svg>
        </button>
        <button id="pane-clear" class="aic-pane-icon" type="button" title="Clear note content" aria-label="Clear note content" hidden>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m4.25 12.25 6.8-7.55a1.4 1.4 0 0 1 2-.08l2.35 2.12a1.4 1.4 0 0 1 .08 2l-6.8 7.55H5.5l-1.25-1.12a2 2 0 0 1 0-2.92ZM9 16.25h7"/></svg>
        </button>
        <button id="pane-delete" class="aic-pane-icon danger" type="button" title="Delete note" aria-label="Delete note" hidden>
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="M3.75 5.5h12.5M8 3.5h4M6 5.5l.65 11h6.7l.65-11M8.25 8.25v5.5M11.75 8.25v5.5"/></svg>
        </button>
        <span class="aic-pane-footer-spacer"></span>
        <button id="pane-pin" class="aic-pane-icon" type="button" title="Pin note" aria-label="Pin note" aria-pressed="false">
          <svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7 3.75 6 1.5-1.3 3.1 2.55 2.55-1.35 1.35-2.55-2.55L7.25 11 5.75 5l1.25-1.25ZM9.35 10.65 4 16"/></svg>
        </button>
      </footer>`,
      "aic-secondary-surface",
    );
    this.disposables.push(
      view.webview.onDidReceiveMessage((message) => this.onMessage(message)),
      view.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
      }),
    );
    if (this.documentUri || this.placeholderUri) await this.sendInit();
    else await this.sendPaneState();
    await this.refreshAuthState();
  }

  async focus(preserveFocus = false) {
    try {
      await vscode.commands.executeCommand(`${SECONDARY_VIEW_ID}.focus`, { preserveFocus });
    } catch {
      await vscode.commands.executeCommand("workbench.action.focusSecondarySideBar");
    }
  }

  async open(uri, { pin = true, reveal = true, sourceUri, selection } = {}) {
    if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) {
      throw structuredError("notes_not_sidecar", `${uri?.fsPath ?? "resource"} is not a *.note.md sidecar`, [
        "Choose a sidecar note",
      ]);
    }
    this.pinned = pin;
    this.sourceUri = sourceUri;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    this.pendingViewState = { selection };
    await this.attach(uri);
    if (reveal) await this.focus(false);
    await this.closeExactNoteTabs(uri);
  }

  async attach(uri) {
    this.readOnly = this.syncService.isReadOnly(uri);
    this.documentUri = uri;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    if (this.document?.uri.toString() === uri.toString() && !this.document.isClosed) {
      await this.sendInit();
      return;
    }
    this.document = await vscode.workspace.openTextDocument(uri);
    this.generation++;
    await this.sendInit();
  }

  async currentDocument() {
    const uri = this.documentUri ?? this.document?.uri;
    if (!uri) return undefined;
    if (!this.document || this.document.isClosed || this.document.uri.toString() !== uri.toString()) {
      this.document = await vscode.workspace.openTextDocument(uri);
      this.readOnly = this.syncService.isReadOnly(uri);
      this.generation++;
    }
    return this.document;
  }

  onDocumentClosed(document) {
    if (this.documentUri?.toString() !== document.uri.toString()) return;
    this.document = undefined;
  }

  async followSource(uri, { force = false, preserveFocus = true } = {}) {
    if (!uri || uri.scheme !== "file" || isNotePath(uri.path) || (this.pinned && !force)) return false;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    if (force) this.pinned = false;
    const relativePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    const notePath = linkedNotePath(relativePath);
    if (!notePath) return false;
    const noteUri = vscode.Uri.joinPath(folder.uri, notePath);
    this.sourceUri = uri;
    if (!(await exists(noteUri))) {
      this.document = undefined;
      this.documentUri = undefined;
      this.pendingViewState = undefined;
      const placeholder = await fileNotePlaceholderForUri(uri);
      this.placeholderUri = placeholder.noteUri;
      this.placeholderText = placeholder.text;
      this.readOnly = false;
      this.generation++;
      await this.sendInit();
      await this.focus(preserveFocus);
      return true;
    }
    this.pendingViewState = undefined;
    await this.attach(noteUri);
    await this.focus(preserveFocus);
    return true;
  }

  async followActive() {
    const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
    const activeTabUri = uriFromTab(vscode.window.tabGroups.activeTabGroup.activeTab);
    const uri = activeEditorUri ?? activeTabUri;
    if (!uri) return;
    if (isNotePath(uri.path)) {
      await this.open(uri, { pin: true, reveal: true });
      return;
    }
    await this.followSource(uri);
  }

  async routeNoteTabs() {
    if (this.routingTabs) return;
    this.routingTabs = true;
    try {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const uri = uriFromTab(tab);
          if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) continue;
          await this.open(uri, { pin: true, reveal: true });
        }
      }
    } finally {
      this.routingTabs = false;
    }
  }

  async closeExactNoteTabs(uri) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (uriFromTab(tab)?.toString() === uri.toString()) {
          await vscode.window.tabGroups.close(tab, true);
        }
      }
    }
  }

  onDocumentChanged(event) {
    if (!this.documentUri || event.document.uri.toString() !== this.documentUri.toString()) return;
    this.document = event.document;
    if (!event.contentChanges.length || this.applying > 0) return;
    this.generation++;
    this.view?.webview.postMessage({
      type: "external",
      generation: this.generation,
      changes: event.contentChanges.map((change) => ({
        from: change.rangeOffset,
        to: change.rangeOffset + change.rangeLength,
        insert: change.text,
      })),
    });
  }

  async onDocumentSaved(document) {
    const key = document.uri.toString();
    if (this.suppressedSaveSync.has(key) || this.documentUri?.toString() !== key) return;
    await this.queueSync(document.uri, { interactive: false, markdown: document.getText() });
  }

  reportSyncError(error) {
    this.sendPaneState("Sync failed").catch(() => undefined);
    vscode.window.showErrorMessage(`AIC Notes — ${formatError(error)}`);
  }

  queueSync(uri, { interactive = false, markdown } = {}) {
    const key = uri.toString();
    return this.syncRequests.enqueue(key, { uri, interactive, markdown });
  }

  async performSync(uri, { interactive, markdown }) {
    const document = await vscode.workspace.openTextDocument(uri);
    const attached = this.documentUri?.toString() === uri.toString();
    const captured = typeof markdown === "string" ? markdown : document.getText();
    if (attached) await this.sendPaneState("Synchronizing…");
    const result = await this.syncService.sync(
      document.uri,
      captured,
      {
        interactive,
        acceptResult: (candidate) => {
          const changedDuringSync = document.getText() !== captured;
          const wouldReplaceCaptured = typeof candidate.localContent === "string" &&
            candidate.localContent !== captured;
          return !(changedDuringSync && wouldReplaceCaptured);
        },
      },
    );
    if (!result) {
      if (attached) await this.sendPaneState("");
      return null;
    }
    if (result.skipped) {
      this.authConnected = false;
      this.authReconnect = Boolean(result.reconnect);
      if (attached) {
        await this.sendPaneState(
          result.reconnect ? "Saved locally · log in again to sync" : "Saved locally · log in to sync",
        );
      }
      return result;
    }
    if (result.stale) {
      if (attached) await this.sendPaneState("Changed during sync · save again");
      return result;
    }
    this.authConnected = true;
    this.authReconnect = false;
    if (typeof result.localContent === "string" && result.localContent !== captured) {
      await this.replaceDocument(result.localContent, uri, { suppressSync: true });
    }
    if (attached) {
      this.readOnly = Boolean(result.readOnly);
      await this.sendPaneState(
        result.action === "locked" ? "Locked in Standard Notes" : `Synced · ${result.action}`,
      );
    }
    return result;
  }

  async saveCurrent({ interactive = false } = {}) {
    await this.editQueue.catch(() => undefined);
    const document = await this.currentDocument();
    if (!document) return null;
    const key = document.uri.toString();
    this.suppressedSaveSync.add(key);
    try {
      const saved = await document.save();
      if (!saved) {
        throw structuredError("notes_save_failed", "the note could not be saved before synchronization", [
          "Resolve the file-system error and retry",
        ]);
      }
    } finally {
      this.suppressedSaveSync.delete(key);
    }
    return this.queueSync(document.uri, { interactive, markdown: document.getText() });
  }

  async syncCurrent() {
    return this.saveCurrent({ interactive: true });
  }

  async sendInit() {
    if (!this.view || !this.ready) {
      await this.sendPaneState();
      return;
    }
    const document = this.documentUri ? await this.currentDocument() : undefined;
    const uri = document?.uri ?? this.placeholderUri;
    const text = document?.getText() ?? this.placeholderText;
    if (!uri || typeof text !== "string") {
      await this.sendPaneState();
      return;
    }
    const relativePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    const viewState = this.pendingViewState;
    await this.view.webview.postMessage({
      type: "init",
      text,
      generation: this.generation,
      relativePath,
      surface: "secondary",
      readOnly: this.readOnly,
      placeholder: !document,
      selection: viewState?.selection,
    });
    this.pendingViewState = undefined;
    await this.sendPaneState();
  }

  async sendPaneState(status = "") {
    if (!this.view) return;
    const relativePath = this.documentUri
      ? vscode.workspace.asRelativePath(this.documentUri, false).replaceAll("\\", "/")
      : "";
    const candidatePath = this.placeholderUri
      ? vscode.workspace.asRelativePath(this.placeholderUri, false).replaceAll("\\", "/")
      : "";
    const displayPath = relativePath || candidatePath;
    const title = displayPath ? path.posix.basename(displayPath) : "Linked Note";
    const parentPath = displayPath ? path.posix.dirname(displayPath) : "";
    const folder = (this.documentUri && vscode.workspace.getWorkspaceFolder(this.documentUri)) ||
      (this.sourceUri && vscode.workspace.getWorkspaceFolder(this.sourceUri));
    this.view.title = title;
    this.view.description = "";
    await this.view.webview.postMessage({
      type: "paneState",
      title,
      breadcrumb: parentPath === "." ? folder?.name ?? "Workspace" : parentPath,
      pinned: this.pinned,
      hasNote: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSurface: Boolean(this.documentUri || this.placeholderUri),
      showPinnedActions: Boolean(this.pinned && this.documentUri),
      canPin: Boolean(this.documentUri || this.placeholderUri || this.sourceUri),
      candidatePath,
      status,
      readOnly: this.readOnly,
      authConnected: this.authConnected,
      authReconnect: this.authReconnect,
      authPending: this.authPending,
      actionPending: this.actionPending,
    });
  }

  async createFromPlaceholder(changes, generation) {
    if (!this.placeholderUri || typeof this.placeholderText !== "string" || this.creating) {
      return undefined;
    }
    if (generation !== this.generation) return undefined;
    const uri = this.placeholderUri;
    const seed = this.placeholderText;
    const text = applyTextChanges(seed, changes);
    this.creating = true;
    try {
      if (await exists(uri)) {
        this.documentUri = uri;
        this.document = await vscode.workspace.openTextDocument(uri);
        this.placeholderUri = undefined;
        this.placeholderText = undefined;
        this.generation++;
        await this.sendInit();
        throw structuredError("notes_placeholder_changed", "the note appeared on disk while its placeholder was open", [
          "Review the on-disk note, then repeat the edit",
        ]);
      }
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      this.documentUri = uri;
      this.document = await vscode.workspace.openTextDocument(uri);
      this.placeholderUri = undefined;
      this.placeholderText = undefined;
      this.readOnly = false;
      await vscode.commands.executeCommand("aicNotes.refreshTree");
      await this.sendPaneState("Created locally · leave the note to sync");
      return this.document;
    } finally {
      this.creating = false;
    }
  }

  async applyChanges(changes, generation) {
    if (!this.documentUri && this.placeholderUri) {
      await this.createFromPlaceholder(changes, generation);
      return;
    }
    const document = await this.currentDocument();
    if (!document) return;
    if (this.readOnly) {
      this.generation++;
      await this.view?.webview.postMessage({
        type: "reset",
        text: document.getText(),
        generation: this.generation,
      });
      throw structuredError("sn_note_read_only", "the linked Standard Notes item is locked or read-only", [
        "Unlock it in Standard Notes and synchronize again",
      ]);
    }
    if (generation !== this.generation) {
      this.generation++;
      await this.view?.webview.postMessage({
        type: "reset",
        text: document.getText(),
        generation: this.generation,
      });
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
      edit.replace(
        document.uri,
        new vscode.Range(document.positionAt(change.from), document.positionAt(change.to)),
        change.insert,
      );
    }
    this.applying++;
    try {
      const applied = await vscode.workspace.applyEdit(edit);
      if (!applied) throw new Error("workspace rejected note edit");
    } finally {
      this.applying--;
    }
  }

  async replaceDocument(text, uri = this.documentUri, { suppressSync = true } = {}) {
    const document = uri ? await vscode.workspace.openTextDocument(uri) : undefined;
    if (!document || text === document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      text,
    );
    this.applying++;
    const key = document.uri.toString();
    if (suppressSync) this.suppressedSaveSync.add(key);
    try {
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error("workspace rejected synced note");
      await document.save();
      if (this.documentUri?.toString() === key) {
        this.document = document;
        this.generation++;
        await this.view?.webview.postMessage({ type: "reset", text, generation: this.generation });
      }
    } finally {
      if (suppressSync) this.suppressedSaveSync.delete(key);
      this.applying--;
    }
  }

  async refreshAuthState(status = "") {
    try {
      const state = await this.syncService.connectionState();
      this.authConnected = state.connected;
      this.authReconnect = state.reconnect;
      await this.sendPaneState(status);
    } catch (error) {
      this.authConnected = false;
      this.authReconnect = true;
      await this.sendPaneState(status || "Session unavailable");
      return error;
    }
    return undefined;
  }

  async authenticate() {
    if (this.authPending) return;
    this.authPending = true;
    await this.sendPaneState(this.authConnected ? "Logging out…" : "Logging in…");
    try {
      if (this.authConnected) {
        const choice = await vscode.window.showWarningMessage(
          "Log out of Standard Notes on this device?",
          {
            modal: true,
            detail: "Only the encrypted local session is removed. Remote notes, local sidecars, sync bindings, and the SecretStorage wrapping key remain unchanged.",
          },
          "Log out locally",
        );
        if (choice !== "Log out locally") return;
        await this.syncService.logout();
      } else {
        await this.syncService.login();
      }
    } finally {
      this.authPending = false;
      await this.refreshAuthState();
    }
  }

  async clearContent() {
    if (this.actionPending || this.readOnly) return;
    const document = await this.currentDocument();
    if (!document) return;
    const relativePath = vscode.workspace.asRelativePath(document.uri, false);
    const choice = await vscode.window.showWarningMessage(
      `Clear local content in ${relativePath}?`,
      {
        modal: true,
        detail: "Valid leading properties stay byte-for-byte. The remaining body becomes one empty checklist item. This destructive local action does not auto-sync; use AIC Notes: Sync Current Note if the remote copy must also be cleared.",
      },
      "Clear Content",
    );
    if (choice !== "Clear Content") return;
    this.actionPending = true;
    await this.sendPaneState("Clearing…");
    try {
      await this.replaceDocument(clearNoteContent(document.getText()));
      await this.sendPaneState("Content cleared locally");
    } finally {
      this.actionPending = false;
      await this.sendPaneState();
    }
  }

  async deleteCurrentNote() {
    if (this.actionPending) return;
    const document = await this.currentDocument();
    if (!document) return;
    const uri = document.uri;
    this.actionPending = true;
    await this.sendPaneState("Waiting for confirmation…");
    try {
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const deleted = await deleteNotes(
        [uri],
        `note "${relativePath}"`,
        undefined,
        "This removes only the local sidecar. The Standard Notes item, lock state, and workspace sync binding are unchanged.",
        async () => {
          const key = document.uri.toString();
          this.suppressedSaveSync.add(key);
          try {
            await document.save();
          } finally {
            this.suppressedSaveSync.delete(key);
          }
        },
      );
      if (!deleted) return;
      this.document = undefined;
      this.documentUri = undefined;
      this.readOnly = false;
      this.pendingViewState = undefined;
      if (this.sourceUri) {
        const placeholder = await fileNotePlaceholderForUri(this.sourceUri);
        this.placeholderUri = placeholder.noteUri;
        this.placeholderText = placeholder.text;
      } else {
        this.placeholderUri = undefined;
        this.placeholderText = undefined;
      }
      this.generation++;
      await vscode.commands.executeCommand("aicNotes.refreshTree");
      if (this.placeholderUri) await this.sendInit();
      else await this.sendPaneState("Note moved to Trash");
    } finally {
      this.actionPending = false;
      await this.sendPaneState();
    }
  }

  async onMessage(message) {
    try {
      switch (message.type) {
        case "ready":
          this.ready = true;
          await this.refreshAuthState();
          if (this.documentUri || this.placeholderUri) await this.sendInit();
          else await this.followActive();
          break;
        case "edit":
          this.editQueue = this.editQueue.catch(() => undefined).then(() =>
            this.applyChanges(message.changes ?? [], message.generation),
          );
          await this.editQueue;
          break;
        case "save":
          await this.saveCurrent({ interactive: false });
          break;
        case "undo":
        case "redo":
          await vscode.commands.executeCommand(message.type);
          break;
        case "pane.pin":
          this.pinned = !this.pinned;
          await this.sendPaneState();
          if (!this.pinned) await this.followActive();
          break;
        case "pane.auth":
          await this.authenticate();
          break;
        case "pane.clear":
          await this.clearContent();
          break;
        case "pane.delete":
          await this.deleteCurrentNote();
          break;
        case "pane.target": {
          const document = await this.currentDocument();
          if (!document) return;
          const folder = vscode.workspace.getWorkspaceFolder(document.uri);
          if (!folder) return;
          const rel = vscode.workspace.asRelativePath(document.uri, false).replaceAll("\\", "/");
          const target = await resolveTarget(folder, rel);
          if (target) await vscode.window.showTextDocument(target);
          break;
        }
        case "bus":
          await this.routeBus(message);
          break;
        case "toast":
          vscode.window.showWarningMessage(`AIC Notes — ${String(message.message ?? "Markdown warning")}`);
          break;
      }
    } catch (error) {
      await this.sendPaneState("Action failed");
      vscode.window.showErrorMessage(`AIC Notes — ${formatError(error)}`);
    }
  }

  async routeBus(message) {
    const { topic, payload } = message;
    if (topic === "link.external") {
      const value = String(payload?.url ?? "");
      if (/^(?:https?:|mailto:|tel:)/iu.test(value)) await vscode.env.openExternal(vscode.Uri.parse(value));
      return;
    }
    if (topic === "file.open" && this.documentUri && payload?.path) {
      const document = await this.currentDocument();
      if (!document) return;
      const folder = vscode.workspace.getWorkspaceFolder(document.uri);
      if (!folder) return;
      const uri = vscode.Uri.joinPath(folder.uri, payload.path);
      if (isNotePath(uri.path)) {
        await this.open(uri, { pin: true, reveal: true });
      } else {
        await openSourceAtHref(uri, payload?.href ?? "");
      }
    }
  }
}
