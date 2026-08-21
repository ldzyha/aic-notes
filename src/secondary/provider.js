import * as vscode from "vscode";
import * as path from "node:path";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import { linkedNotePath, isNotePath } from "./model.js";
import { resolveTarget } from "../notes/target.js";
import { ensureFileNoteForUri } from "../notes/create.js";
import { openSourceAtHref } from "../notes/navigation.js";
import { clearNoteContent } from "./note-actions.js";
import { deleteNotes } from "../notes/delete.js";

export const SECONDARY_VIEW_ID = "aicNotes.secondary";
const AUTO_OPEN_KEY = "aicNotes.secondary.autoOpenExisting";

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
    this.explorerTargetUri = undefined;
    this.disposables = [];
    this.routingTabs = false;
    this.autoOpen = context.workspaceState.get(AUTO_OPEN_KEY, true);
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
      `<section id="secondary-controls" aria-label="Linked note controls">
        <div class="aic-pane-context">
          <strong id="pane-filename"></strong>
          <button id="pane-breadcrumb" class="aic-pane-breadcrumb" type="button" title="Reveal folder in Explorer"></button>
        </div>
        <div class="aic-pane-actions">
          <button id="pane-pin" type="button" title="Pin or follow active file">Pin</button>
          <button id="pane-target" type="button">Source</button>
          <button id="pane-sync" type="button">Sync</button>
          <button id="pane-auth" type="button">Log in</button>
          <div class="aic-pane-menu-wrap">
            <button id="pane-note-actions" type="button" aria-haspopup="menu" aria-expanded="false" title="Note actions">
              <svg aria-hidden="true" viewBox="0 0 16 16"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
              <span>Note</span>
            </button>
            <div id="pane-note-menu" class="aic-pane-menu" role="menu" hidden>
              <button id="pane-clear" type="button" role="menuitem">Clear content</button>
              <button id="pane-delete" class="danger" type="button" role="menuitem">Delete note</button>
            </div>
          </div>
        </div>
        <label class="aic-pane-auto"><input id="pane-auto" type="checkbox"> Auto-open linked note</label>
        <span id="pane-status" role="status"></span>
      </section>
      <div id="pane-empty" class="aic-pane-empty">
        <strong>No linked note yet</strong>
        <span id="pane-empty-detail">Focus a workspace source file.</span>
        <code id="pane-candidate"></code>
        <button id="pane-create" type="button">Create note</button>
      </div>
      <div id="editor"></div>`,
      "aic-secondary-surface",
    );
    this.disposables.push(
      view.webview.onDidReceiveMessage((message) => this.onMessage(message)),
      view.onDidDispose(() => {
        this.view = undefined;
        this.ready = false;
      }),
    );
    if (this.documentUri) await this.sendInit();
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
    this.pendingViewState = { selection };
    await this.attach(uri);
    if (reveal) await this.focus(false);
    await this.closeExactNoteTabs(uri);
  }

  async attach(uri) {
    this.readOnly = this.syncService.isReadOnly(uri);
    this.documentUri = uri;
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

  async followSource(uri, { forceReveal = false } = {}) {
    if (!uri || uri.scheme !== "file" || isNotePath(uri.path) || this.pinned) return false;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const relativePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    const notePath = linkedNotePath(relativePath);
    if (!notePath) return false;
    const noteUri = vscode.Uri.joinPath(folder.uri, notePath);
    this.sourceUri = uri;
    if (!(await exists(noteUri))) {
      this.document = undefined;
      this.documentUri = undefined;
      this.pendingViewState = undefined;
      this.generation++;
      await this.sendPaneState();
      return false;
    }
    this.pendingViewState = undefined;
    await this.attach(noteUri);
    if (forceReveal || this.autoOpen) await this.focus(true);
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

  async sendInit() {
    if (!this.documentUri || !this.view || !this.ready) {
      await this.sendPaneState();
      return;
    }
    const document = await this.currentDocument();
    if (!document) return;
    const relativePath = vscode.workspace.asRelativePath(document.uri, false).replaceAll("\\", "/");
    const viewState = this.pendingViewState;
    await this.view.webview.postMessage({
      type: "init",
      text: document.getText(),
      generation: this.generation,
      relativePath,
      surface: "secondary",
      readOnly: this.readOnly,
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
    let candidatePath = "";
    if (!this.documentUri && this.sourceUri) {
      const folder = vscode.workspace.getWorkspaceFolder(this.sourceUri);
      if (folder) {
        const sourcePath = vscode.workspace.asRelativePath(this.sourceUri, false).replaceAll("\\", "/");
        candidatePath = linkedNotePath(sourcePath) ?? "";
      }
    }
    const displayPath = relativePath || candidatePath;
    const title = displayPath ? path.posix.basename(displayPath) : "Linked Note";
    const parentPath = displayPath ? path.posix.dirname(displayPath) : "";
    const folder = (this.documentUri && vscode.workspace.getWorkspaceFolder(this.documentUri)) ||
      (this.sourceUri && vscode.workspace.getWorkspaceFolder(this.sourceUri));
    this.explorerTargetUri = folder && displayPath
      ? vscode.Uri.joinPath(folder.uri, parentPath === "." ? "" : parentPath)
      : undefined;
    this.view.title = title;
    this.view.description = "";
    await this.view.webview.postMessage({
      type: "paneState",
      title,
      breadcrumb: parentPath === "." ? folder?.name ?? "Workspace" : parentPath,
      pinned: this.pinned,
      autoOpen: this.autoOpen,
      hasNote: Boolean(this.documentUri),
      canCreate: Boolean(candidatePath) && !this.creating,
      candidatePath,
      status,
      readOnly: this.readOnly,
      authConnected: this.authConnected,
      authReconnect: this.authReconnect,
      authPending: this.authPending,
      actionPending: this.actionPending,
    });
  }

  async applyChanges(changes, generation) {
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

  async replaceDocument(text) {
    const document = await this.currentDocument();
    if (!document || text === document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
      text,
    );
    this.applying++;
    try {
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error("workspace rejected synced note");
      await document.save();
      this.generation++;
      await this.view?.webview.postMessage({ type: "reset", text, generation: this.generation });
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
        detail: "Valid leading properties stay byte-for-byte. The remaining body becomes one empty checklist item. Standard Notes is not changed until a later explicit Sync.",
      },
      "Clear Content",
    );
    if (choice !== "Clear Content") return;
    this.actionPending = true;
    await this.sendPaneState("Clearing…");
    try {
      await this.replaceDocument(clearNoteContent(document.getText()));
      await this.sendPaneState("Content cleared");
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
        () => document.save(),
      );
      if (!deleted) return;
      this.document = undefined;
      this.documentUri = undefined;
      this.readOnly = false;
      this.pendingViewState = undefined;
      this.generation++;
      await vscode.commands.executeCommand("aicNotes.refreshTree");
      await this.sendPaneState("Note moved to Trash");
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
          if (this.documentUri) await this.sendInit();
          else await this.followActive();
          break;
        case "edit":
          this.editQueue = this.editQueue.catch(() => undefined).then(() =>
            this.applyChanges(message.changes ?? [], message.generation),
          );
          await this.editQueue;
          break;
        case "save":
          await (await this.currentDocument())?.save();
          break;
        case "undo":
        case "redo":
          await vscode.commands.executeCommand(message.type);
          break;
        case "pane.autoOpen":
          this.autoOpen = Boolean(message.value);
          await this.context.workspaceState.update(AUTO_OPEN_KEY, this.autoOpen);
          await this.sendPaneState();
          break;
        case "pane.pin":
          this.pinned = !this.pinned;
          await this.sendPaneState();
          if (!this.pinned) await this.followActive();
          break;
        case "pane.create": {
          if (this.documentUri || !this.sourceUri || this.creating) return;
          const sourceUri = this.sourceUri;
          this.creating = true;
          await this.sendPaneState("Creating…");
          try {
            const noteUri = await ensureFileNoteForUri(sourceUri);
            await this.open(noteUri, {
              pin: false,
              reveal: true,
              sourceUri,
            });
          } finally {
            this.creating = false;
            await this.sendPaneState("");
          }
          break;
        }
        case "pane.auth":
          await this.authenticate();
          break;
        case "pane.reveal":
          if (this.explorerTargetUri) {
            await vscode.commands.executeCommand("revealInExplorer", this.explorerTargetUri);
          }
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
        case "pane.sync": {
          const document = await this.currentDocument();
          if (!document) return;
          await document.save();
          await this.sendPaneState("Synchronizing…");
          const result = await this.syncService.sync(document.uri, document.getText());
          await this.refreshAuthState();
          if (!result) {
            await this.sendPaneState("");
            return;
          }
          if (typeof result.localContent === "string") await this.replaceDocument(result.localContent);
          this.readOnly = Boolean(result.readOnly);
          await this.sendPaneState(
            result.action === "locked" ? "Locked in Standard Notes" : `Synced · ${result.action}`,
          );
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
      await this.sendPaneState(message.type === "pane.sync" ? "Sync failed" : "Action failed");
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
