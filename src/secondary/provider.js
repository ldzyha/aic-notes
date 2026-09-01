import * as vscode from "vscode";
import * as path from "node:path";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import { applyTextChanges, isNotePath } from "./model.js";
import { resolveTarget } from "../notes/target.js";
import { noteDescriptorForUri, notePlaceholderForUri } from "../notes/create.js";
import { noteRelationshipsForTarget } from "../notes/relationships.js";
import { openSourceAtHref } from "../notes/navigation.js";
import { trashNotesLocally } from "../notes/delete.js";
import { CoalescingQueue, mergeSyncRequests } from "../sync/coalescing-queue.js";
import { syncAdmission } from "../sync/admission.js";

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
    const noteWatcher = vscode.workspace.createFileSystemWatcher("**/*.note.md");
    context.subscriptions.push(
      pane,
      noteWatcher,
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
      vscode.workspace.onDidCloseTextDocument((document) => pane.onDocumentClosed(document)),
      noteWatcher.onDidCreate(() => pane.refreshRelationships()),
      noteWatcher.onDidDelete(() => pane.refreshRelationships()),
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
    this.draftEpoch = 0;
    this.draftDirty = false;
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
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
  }

  async resolveWebviewView(view) {
    this.view = view;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    view.webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    this.disposables.push(
      view.webview.onDidReceiveMessage((message) => this.onMessage(message)),
      view.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
      }),
    );
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
        <button id="pane-auth" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="login" aria-label="Log in to Standard Notes"></button>
        <button id="pane-target" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="source" aria-label="Open source" hidden></button>
        <button id="pane-clear" class="aic-pane-icon cm-aic-icon-button danger" type="button" data-aic-icon="trash" aria-label="Move note to Trash" hidden></button>
        <span class="aic-pane-footer-spacer"></span>
        <button id="pane-pin" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="pin" aria-label="Pin note" aria-pressed="false"></button>
      </footer>`,
      "aic-secondary-surface",
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
    const currentUri = this.documentUri ?? this.placeholderUri;
    if (this.draftDirty && currentUri?.toString() === uri.toString()) {
      await this.closeExactNoteTabs(uri);
      if (reveal) await this.focus(false);
      return true;
    }
    if (this.draftDirty) {
      await this.sendPaneState("Unsaved · press Ctrl+S before switching notes");
      if (reveal) await this.focus(false);
      return false;
    }
    this.pinned = pin;
    this.sourceUri = sourceUri;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    this.pendingViewState = { selection };
    if (!(await exists(uri))) {
      if (!(await this.recoverPlaceholder(uri, sourceUri))) {
        throw structuredError("notes_missing", `${uri.fsPath} no longer exists`, [
          "Restore its source or select another workspace item",
        ]);
      }
      await this.sendInit();
      await this.closeExactNoteTabs(uri);
      if (reveal) await this.focus(false);
      return true;
    }
    await this.attach(uri);
    await this.closeExactNoteTabs(uri);
    if (reveal) await this.focus(false);
    return true;
  }

  // A note URI can outlive its file: project placeholders are deliberately
  // lazy, and sidecars may be moved/deleted while the Secondary view remains
  // open. Rebuild the preview from the still-existing owner instead of asking
  // VS Code's text-document service to open a nonexistent file.
  async recoverPlaceholder(uri, sourceUri = this.sourceUri) {
    if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) return false;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = folder
      ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
      : "";
    const target = folder ? await resolveTarget(folder, relativePath) : null;
    if (!target) return false;
    const placeholder = await notePlaceholderForUri(target);
    this.sourceUri = sourceUri ?? target;
    this.document = undefined;
    this.documentUri = undefined;
    this.placeholderUri = placeholder.noteUri;
    this.placeholderText = placeholder.text;
    this.readOnly = false;
    this.generation++;
    return true;
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
    if (!(await exists(uri))) {
      if (await this.recoverPlaceholder(uri)) {
        await this.sendInit();
        await this.closeExactNoteTabs(uri);
        return undefined;
      }
      this.document = undefined;
      this.documentUri = undefined;
      return undefined;
    }
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
    return this.followTarget(uri, { force, preserveFocus });
  }

  async followTarget(uri, { force = false, preserveFocus = true } = {}) {
    if (!uri || uri.scheme !== "file" || isNotePath(uri.path) || (this.pinned && !force)) return false;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    if (force) this.pinned = false;
    const descriptor = await noteDescriptorForUri(uri);
    const noteUri = descriptor.noteUri;
    const currentUri = this.documentUri ?? this.placeholderUri;
    if (this.draftDirty && currentUri?.toString() === noteUri.toString()) {
      await this.focus(preserveFocus);
      return true;
    }
    if (this.draftDirty) {
      await this.sendPaneState("Unsaved · press Ctrl+S before following another file");
      return false;
    }
    this.sourceUri = uri;
    if (!(await exists(noteUri))) {
      this.document = undefined;
      this.documentUri = undefined;
      this.pendingViewState = undefined;
      const placeholder = await notePlaceholderForUri(uri);
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

  reportSyncError(error) {
    this.sendPaneState("Sync failed").catch(() => undefined);
    vscode.window.showErrorMessage(`AIC Notes — ${formatError(error)}`);
  }

  queueSync(uri, { interactive = false, resolveConflicts = interactive, markdown } = {}) {
    const key = uri.toString();
    return this.syncRequests.enqueue(key, { uri, interactive, resolveConflicts, markdown });
  }

  async placeholderForSync(uri) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return "";
    const notePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    let source = this.sourceUri;
    if (source) {
      const sourceFolder = vscode.workspace.getWorkspaceFolder(source);
      const descriptor = sourceFolder ? await noteDescriptorForUri(source) : undefined;
      if (sourceFolder?.uri.toString() !== folder.uri.toString() || descriptor?.notePath !== notePath) {
        source = undefined;
      }
    }
    source ??= await resolveTarget(folder, notePath);
    if (!source) return "";
    return (await notePlaceholderForUri(source)).text;
  }

  async performSync(uri, { interactive, resolveConflicts, markdown, draftEpoch }) {
    const document = await vscode.workspace.openTextDocument(uri);
    const attached = this.documentUri?.toString() === uri.toString();
    const captured = typeof markdown === "string" ? markdown : document.getText();
    const admission = syncAdmission(captured, await this.placeholderForSync(document.uri));
    if (!admission.admit) {
      if (attached) {
        await this.sendPaneState(
          admission.reason === "placeholder"
            ? "Not synced · unchanged placeholder"
            : "Not synced · empty note",
        );
      }
      return { action: `skipped-${admission.reason}`, skipped: true, admission: true };
    }
    if (attached) await this.sendPaneState("Synchronizing…");
    const result = await this.syncService.sync(
      document.uri,
      captured,
      {
        interactive,
        resolveConflicts,
        acceptResult: (candidate) => {
          const changedDuringSync = document.getText() !== captured;
          const newerWebviewDraft = Number.isSafeInteger(draftEpoch) && this.draftEpoch !== draftEpoch;
          const wouldReplaceCaptured = typeof candidate.localContent === "string" &&
            candidate.localContent !== captured;
          return !((changedDuringSync || newerWebviewDraft) && wouldReplaceCaptured);
        },
      },
    );
    if (!result) {
      if (attached) await this.sendPaneState("");
      return null;
    }
    if (result.conflict) {
      this.authConnected = true;
      this.authReconnect = false;
      if (attached) await this.sendPaneState("Conflict · save again to choose a version");
      return result;
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
      await this.replaceDocument(result.localContent, uri);
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
    if (!document) {
      if (this.placeholderUri) await this.sendPaneState("Not synced · unchanged placeholder");
      return this.placeholderUri
        ? { action: "skipped-placeholder", skipped: true, admission: true }
        : null;
    }
    const saved = await document.save();
    if (!saved) {
      await this.sendPaneState("Save failed · note kept in the editor");
      return { action: "save-failed", skipped: true };
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
    let relationshipTarget = this.sourceUri;
    if (!relationshipTarget) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      relationshipTarget = folder ? await resolveTarget(folder, relativePath) : undefined;
    }
    const relationships = relationshipTarget
      ? await noteRelationshipsForTarget(relationshipTarget)
      : [];
    const viewState = this.pendingViewState;
    this.draftDirty = false;
    await this.view.webview.postMessage({
      type: "init",
      text,
      generation: this.generation,
      relativePath,
      surface: "secondary",
      readOnly: this.readOnly,
      placeholder: !document,
      relationships,
      selection: viewState?.selection,
    });
    this.pendingViewState = undefined;
    await this.sendPaneState();
  }

  async refreshRelationships() {
    if (!this.view || !this.ready || (!this.documentUri && !this.placeholderUri)) return;
    const uri = this.documentUri ?? this.placeholderUri;
    let target = this.sourceUri;
    if (!target && uri) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = folder
        ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
        : "";
      target = folder ? await resolveTarget(folder, relativePath) : undefined;
    }
    const relationships = target ? await noteRelationshipsForTarget(target) : [];
    await this.view.webview.postMessage({ type: "relationships", relationships });
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
    const visibleStatus = this.draftDirty
      ? "Unsaved · Ctrl+S"
      : status || (this.authReconnect
        ? "Standard Notes · Reconnect required"
        : this.authConnected
          ? "Standard Notes · Connected"
          : "Standard Notes · Disconnected");
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
      status: visibleStatus,
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

  async replaceDocument(text, uri = this.documentUri) {
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
    try {
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error("workspace rejected synced note");
      await document.save();
      if (this.documentUri?.toString() === key) {
        this.document = document;
        this.generation++;
        await this.view?.webview.postMessage({ type: "reset", text, generation: this.generation });
      }
    } finally {
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
    await this.editQueue.catch(() => undefined);
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
        const connected = await this.syncService.login();
        if (connected) await this.importProjectNotes({ ensureConnected: false });
      }
    } finally {
      this.authPending = false;
      await this.refreshAuthState();
    }
  }

  async commitDraft(text, generation, reason = "explicit") {
    const draft = String(text ?? "");
    if (this.readOnly) {
      await this.view?.webview.postMessage({
        type: "committed",
        text: draft,
        generation: this.generation,
        saved: false,
      });
      await this.sendPaneState("Read-only · draft not saved");
      return { action: "read-only", skipped: true };
    }
    if (generation !== this.generation) {
      await this.view?.webview.postMessage({
        type: "committed",
        text: draft,
        generation: this.generation,
        saved: false,
      });
      await this.sendPaneState("File changed externally · draft kept in the editor");
      return { action: "stale-draft", skipped: true };
    }

    let document;
    if (!this.documentUri && this.placeholderUri) {
      if (draft === this.placeholderText) {
        await this.view?.webview.postMessage({
          type: "committed",
          text: draft,
          generation: this.generation,
          saved: true,
        });
        await this.sendPaneState("Not saved · unchanged placeholder");
        return { action: "placeholder", skipped: true };
      }
      const uri = this.placeholderUri;
      if (await exists(uri)) {
        await this.view?.webview.postMessage({
          type: "committed",
          text: draft,
          generation: this.generation,
          saved: false,
        });
        await this.sendPaneState("Note appeared on disk · draft kept in the editor");
        return { action: "appeared", skipped: true };
      }
      try {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(draft));
      } catch {
        await this.view?.webview.postMessage({
          type: "committed",
          text: draft,
          generation: this.generation,
          saved: false,
        });
        await this.sendPaneState("Save failed · draft kept in the editor");
        return { action: "save-failed", skipped: true };
      }
      this.documentUri = uri;
      this.document = await vscode.workspace.openTextDocument(uri);
      this.placeholderUri = undefined;
      this.placeholderText = undefined;
      document = this.document;
      await vscode.commands.executeCommand("aicNotes.refreshTree");
    } else {
      if (this.documentUri && !(await exists(this.documentUri))) {
        try {
          await vscode.workspace.fs.writeFile(this.documentUri, new TextEncoder().encode(draft));
          this.document = await vscode.workspace.openTextDocument(this.documentUri);
          document = this.document;
          await vscode.commands.executeCommand("aicNotes.refreshTree");
        } catch {
          await this.view?.webview.postMessage({
            type: "committed",
            text: draft,
            generation: this.generation,
            saved: false,
          });
          await this.sendPaneState("Save failed · draft kept in the editor");
          return { action: "save-failed", skipped: true };
        }
      } else {
        document = await this.currentDocument();
      }
      if (!document) {
        await this.view?.webview.postMessage({
          type: "committed",
          text: draft,
          generation: this.generation,
          saved: false,
        });
        await this.sendPaneState("Note is unavailable · draft kept in the editor");
        return { action: "missing", skipped: true };
      }
      if (document.getText() !== draft) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(
          document.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          draft,
        );
        this.applying++;
        try {
          if (!(await vscode.workspace.applyEdit(edit))) {
            await this.view?.webview.postMessage({
              type: "committed",
              text: draft,
              generation: this.generation,
              saved: false,
            });
            await this.sendPaneState("Save failed · draft kept in the editor");
            return { action: "save-failed", skipped: true };
          }
          this.document = document;
        } finally {
          this.applying--;
        }
      }
    }

    let saved = false;
    try {
      saved = await document.save();
    } catch {
      // A sidecar can disappear between the existence check and save. The
      // webview remains the draft owner; keep it dirty and let the next
      // Ctrl+S retry instead of surfacing a disruptive host error.
    }
    await this.view?.webview.postMessage({
      type: "committed",
      text: draft,
      generation: this.generation,
      saved,
    });
    if (!saved) {
      await this.sendPaneState("Save failed · draft kept in the editor");
      return { action: "save-failed", skipped: true };
    }
    this.draftDirty = false;
    await this.sendPaneState("Saved · synchronizing…");
    return this.queueSync(document.uri, {
      interactive: false,
      resolveConflicts: true,
      markdown: draft,
      draftEpoch: this.draftEpoch,
    });
  }

  async importProjectNotes({ ensureConnected = true } = {}) {
    if (ensureConnected && !(await this.syncService.ensureConnected())) return null;
    await this.sendPaneState("Connected · reconciling workspace notes…");
    const summary = await this.syncService.reconcileOpenWorkspaces({ showProgress: true });
    await vscode.commands.executeCommand("aicNotes.refreshTree");
    if (this.placeholderUri && await exists(this.placeholderUri)) {
      await this.attach(this.placeholderUri);
    } else if (this.documentUri || this.placeholderUri) {
      if (this.draftDirty) await this.refreshRelationships();
      else await this.sendInit();
    }
    vscode.window.showInformationMessage(
      `AIC Notes: imported ${summary.imported?.created ?? 0}, linked ${summary.imported?.linked ?? 0}, synchronized ${summary.synced}, conflicts ${summary.conflicts}, skipped ${summary.skipped}, failed ${summary.failed}`,
    );
    return summary;
  }

  async initializeWorkspaceSync() {
    const summary = await this.syncService.reconcileOpenWorkspaces({ showProgress: false });
    if (!summary.connected) {
      this.authConnected = false;
      this.authReconnect = Boolean(summary.reconnect);
      await this.sendPaneState();
      return summary;
    }
    this.authConnected = true;
    this.authReconnect = false;
    await vscode.commands.executeCommand("aicNotes.refreshTree");
    if (this.placeholderUri && await exists(this.placeholderUri)) {
      await this.attach(this.placeholderUri);
    } else if (this.documentUri || this.placeholderUri) {
      if (this.draftDirty) await this.refreshRelationships();
      else await this.sendInit();
    }
    await this.sendPaneState(
      summary.failed
        ? `Workspace sync finished · ${summary.failed} failed`
        : `Workspace notes ready · ${summary.synced} synchronized`,
    );
    return summary;
  }

  async trashCurrentNote() {
    if (this.actionPending) return;
    await this.editQueue.catch(() => undefined);
    const document = await this.currentDocument();
    if (!document) return;
    const uri = document.uri;
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const binding = this.syncService.bindingState(uri);
    const choice = await vscode.window.showWarningMessage(
      `Move note "${relativePath}" to Trash?`,
      {
        modal: true,
        detail: binding.bound
          ? "The exact bound note moves to Standard Notes Trash first, then the local sidecar moves to the system Trash. The sync binding is removed only after both operations succeed."
          : "This note has no Standard Notes binding. Only the local sidecar moves to the system Trash.",
      },
      "Move to Trash",
    );
    if (choice !== "Move to Trash") return;
    this.actionPending = true;
    let finalStatus = "";
    await this.sendPaneState(binding.bound ? "Moving remote note to Trash…" : "Moving local note to Trash…");
    try {
      if (!(await document.save())) {
        throw structuredError("notes_save_failed", "the note could not be saved before moving it to Trash", [
          "Resolve the file-system error and retry",
        ]);
      }

      if (binding.bound) {
        const remote = await this.syncService.trash(uri);
        if (!remote) {
          finalStatus = "Trash cancelled · note kept locally";
          return;
        }
        await this.sendPaneState("Remote in Trash · moving local note…");
      }

      const deleted = await trashNotesLocally([uri]);
      if (!deleted && binding.bound) {
        finalStatus = "Remote in Trash · local note kept for retry";
      }
      if (!deleted) return;
      await this.syncService.completeTrash(uri);
      this.document = undefined;
      this.documentUri = undefined;
      this.readOnly = false;
      this.pendingViewState = undefined;
      if (this.sourceUri) {
        const placeholder = await notePlaceholderForUri(this.sourceUri);
        this.placeholderUri = placeholder.noteUri;
        this.placeholderText = placeholder.text;
      } else {
        this.placeholderUri = undefined;
        this.placeholderText = undefined;
      }
      this.generation++;
      await vscode.commands.executeCommand("aicNotes.refreshTree");
      if (this.placeholderUri) await this.sendInit();
      finalStatus = binding.bound
        ? "Moved to Trash locally and in Standard Notes"
        : "Moved local note to Trash";
    } finally {
      this.actionPending = false;
      await this.sendPaneState(finalStatus);
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
        case "commit":
          this.editQueue = this.editQueue.catch(() => undefined).then(() =>
            this.commitDraft(message.text, message.generation, message.reason),
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
        case "pane.delete":
          await this.trashCurrentNote();
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
        case "draft.externalConflict":
          await this.sendPaneState("File changed externally · current draft was not replaced");
          break;
        case "draft.state":
          this.draftEpoch++;
          this.draftDirty = Boolean(message.dirty);
          await this.sendPaneState();
          break;
      }
    } catch (error) {
      await this.sendPaneState("Action failed");
      vscode.window.showErrorMessage(`AIC Notes — ${formatError(error)}`);
    }
  }

  async routeBus(message) {
    const { topic, payload } = message;
    if (topic === "clipboard.write") {
      const text = typeof payload?.text === "string" ? payload.text : "";
      if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
        vscode.window.showWarningMessage("AIC Notes — clipboard payload exceeds 2 MiB");
        return;
      }
      await vscode.env.clipboard.writeText(text);
      vscode.window.setStatusBarMessage(`AIC Notes: copied ${String(payload?.label ?? "source")}`, 2000);
      return;
    }
    if (topic === "link.external") {
      const value = String(payload?.url ?? "");
      if (/^(?:https?:|mailto:|tel:)/iu.test(value)) await vscode.env.openExternal(vscode.Uri.parse(value));
      return;
    }
    if (topic === "note.open" && (this.documentUri || this.placeholderUri) && payload?.path) {
      const baseUri = this.documentUri ?? this.placeholderUri;
      const folder = baseUri ? vscode.workspace.getWorkspaceFolder(baseUri) : undefined;
      if (!folder) return;
      const relativePath = String(payload.path).replaceAll("\\", "/");
      if (
        !relativePath.endsWith(".note.md") || relativePath.startsWith("/") ||
        relativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")
      ) return;
      await this.open(vscode.Uri.joinPath(folder.uri, relativePath), { pin: true, reveal: true });
      return;
    }
    if (topic === "file.open" && (this.documentUri || this.placeholderUri) && payload?.path) {
      const document = this.documentUri ? await this.currentDocument() : undefined;
      const baseUri = document?.uri ?? this.placeholderUri;
      if (!baseUri) return;
      const folder = vscode.workspace.getWorkspaceFolder(baseUri);
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
