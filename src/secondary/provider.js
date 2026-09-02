import * as vscode from "vscode";
import * as path from "node:path";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import {
  activeResource,
  isNotePath,
  NavigationQueue,
  paneCapabilities,
  preferredWorkspaceFolder,
} from "./model.js";
import { resolveTarget } from "../notes/target.js";
import { noteDescriptorForUri, notePlaceholderForUri } from "../notes/create.js";
import { noteRelationshipsForTarget } from "../notes/relationships.js";
import { openSourceAtHref } from "../notes/navigation.js";
import { trashNotesLocally } from "../notes/delete.js";
import { stampFileProperties } from "../../vendor/aic-editor-core/file-properties.js";

export const SECONDARY_VIEW_ID = "aicNotes.secondary";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function stampNoteProperties(markdown, uri) {
  const updatedAt = new Date().toISOString();
  let createdAt = updatedAt;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (Number.isFinite(stat.ctime) && stat.ctime > 0)
      createdAt = new Date(stat.ctime).toISOString();
  } catch {
    // A new placeholder has no file stat yet; its first explicit save is the
    // creation timestamp.
  }
  return stampFileProperties(markdown, {
    fileName: path.basename(uri.fsPath),
    createdAt,
    updatedAt,
  });
}

function uriFromTab(tab) {
  return tab?.input?.uri ?? tab?.input?.modified ?? undefined;
}

export class SecondaryNotePane {
  static register(context) {
    const pane = new SecondaryNotePane(context);
    const noteWatcher = vscode.workspace.createFileSystemWatcher("**/*.note.md");
    context.subscriptions.push(
      pane,
      noteWatcher,
      vscode.window.registerWebviewViewProvider(SECONDARY_VIEW_ID, pane, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.window.registerCustomEditorProvider("aicNotes.noteRedirect", {
        async resolveCustomTextEditor(document, panel) {
          await pane.open(document.uri, { reveal: true });
          panel.dispose();
        },
      }),
      vscode.window.onDidChangeActiveTextEditor(() => pane.followActive()),
      vscode.window.tabGroups.onDidChangeTabs(() => pane.routeActiveNoteTab()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => pane.followActive()),
      vscode.workspace.onDidChangeTextDocument((event) => pane.onDocumentChanged(event)),
      vscode.workspace.onDidCloseTextDocument((document) => pane.onDocumentClosed(document)),
      noteWatcher.onDidCreate(() => pane.refreshRelationships()),
      noteWatcher.onDidDelete(() => pane.refreshRelationships()),
    );
    queueMicrotask(() => pane.routeActiveNoteTab());
    return pane;
  }

  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.document = undefined;
    this.documentUri = undefined;
    this.sourceUri = undefined;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    this.pinned = false;
    this.ready = false;
    this.generation = 0;
    this.draftDirty = false;
    this.applying = 0;
    this.editQueue = Promise.resolve();
    this.pendingViewState = undefined;
    this.actionPending = false;
    this.disposables = [];
    this.suppressFollowing = 0;
    this.navigation = new NavigationQueue();
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
        <button id="pane-target" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="source" aria-label="Open source" hidden></button>
        <button id="pane-clear" class="aic-pane-icon cm-aic-icon-button danger" type="button" data-aic-icon="trash" aria-label="Move note to Trash" hidden></button>
        <span class="aic-pane-footer-spacer"></span>
        <button id="pane-pin" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="pin" aria-label="Pin note" aria-pressed="false"></button>
      </footer>`,
      "aic-secondary-surface",
    );
    if (this.documentUri || this.placeholderUri) await this.sendInit();
    else await this.sendPaneState();
  }

  async focus(preserveFocus = false) {
    try {
      await vscode.commands.executeCommand(`${SECONDARY_VIEW_ID}.focus`, { preserveFocus });
    } catch {
      await vscode.commands.executeCommand("workbench.action.focusSecondarySideBar");
    }
  }

  open(uri, options = {}) {
    return this.navigation.enqueue(() => this.openNow(uri, options));
  }

  async openNow(uri, { pin, reveal = true, sourceUri, selection } = {}) {
    if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) {
      throw structuredError("notes_not_sidecar", `${uri?.fsPath ?? "resource"} is not a *.note.md sidecar`, [
        "Choose a sidecar note",
      ]);
    }
    const currentUri = this.documentUri ?? this.placeholderUri;
    if (this.draftDirty && currentUri?.toString() === uri.toString()) {
      if (typeof pin === "boolean") this.pinned = pin;
      await this.sendPaneState();
      await this.finishNoteRouting(uri, reveal);
      return true;
    }
    if (this.draftDirty) {
      await this.sendPaneState("Unsaved · press Ctrl+S before switching notes");
      if (reveal) await this.focus(false);
      return false;
    }
    if (typeof pin === "boolean") this.pinned = pin;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = folder
      ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
      : "";
    this.sourceUri =
      sourceUri ??
      (folder ? await resolveTarget(folder, relativePath) : undefined);
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
      await this.finishNoteRouting(uri, reveal);
      return true;
    }
    await this.attach(uri);
    await this.finishNoteRouting(uri, reveal);
    return true;
  }

  async finishNoteRouting(uri, reveal) {
    this.suppressFollowing++;
    try {
      await this.closeExactNoteTabs(uri);
      if (reveal) await this.focus(false);
    } finally {
      this.suppressFollowing--;
    }
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
    this.generation++;
    return true;
  }

  async attach(uri) {
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

  followTarget(uri, options = {}) {
    return this.navigation.enqueue(() => this.followTargetNow(uri, options));
  }

  async followTargetNow(uri, { force = false, preserveFocus = true } = {}) {
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
    if (this.suppressFollowing > 0) return false;
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const activeEditorUri = vscode.window.activeTextEditor?.document.uri;
    const activeTabUri = uriFromTab(activeTab);
    const uri = activeResource(
      activeTabUri,
      activeEditorUri,
      Boolean(activeTab),
    );
    if (!uri) {
      const folder = preferredWorkspaceFolder(
        [this.sourceUri, this.documentUri, this.placeholderUri],
        vscode.workspace.workspaceFolders,
        (candidate) => vscode.workspace.getWorkspaceFolder(candidate),
      );
      return folder
        ? this.followTarget(folder.uri, { preserveFocus: true })
        : false;
    }
    if (isNotePath(uri.path)) {
      return this.open(uri, { reveal: true });
    }
    return this.followSource(uri);
  }

  routeActiveNoteTab() {
    if (this.suppressFollowing > 0) return false;
    const uri = uriFromTab(
      vscode.window.tabGroups.activeTabGroup.activeTab,
    );
    if (uri?.scheme === "file" && isNotePath(uri.path))
      return this.open(uri, { reveal: true });
    return this.followActive();
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
    const capabilities = paneCapabilities({
      hasDocument: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSource: Boolean(this.sourceUri),
    });
    const visibleStatus = this.draftDirty
      ? "Unsaved · Ctrl+S"
      : status || (this.documentUri
        ? "Saved locally"
        : this.placeholderUri
          ? "Placeholder · Ctrl+S to create"
          : "");
    this.view.title = title;
    this.view.description = "";
    await this.view.webview.postMessage({
      type: "paneState",
      title,
      breadcrumb: parentPath === "." ? folder?.name ?? "Workspace" : parentPath,
      pinned: this.pinned,
      hasNote: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSurface: capabilities.hasSurface,
      canOpenTarget: capabilities.canOpenTarget,
      canTrash: capabilities.canTrash,
      canPin: capabilities.canPin,
      candidatePath,
      status: visibleStatus,
      actionPending: this.actionPending,
    });
  }

  async commitDraft(text, generation) {
    let draft = String(text ?? "");
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

    if (
      !this.documentUri &&
      this.placeholderUri &&
      draft === this.placeholderText
    ) {
      await this.view?.webview.postMessage({
        type: "committed",
        text: draft,
        generation: this.generation,
        saved: true,
      });
      await this.sendPaneState("Not saved · unchanged placeholder");
      return { action: "placeholder", skipped: true };
    }

    const noteUri = this.documentUri ?? this.placeholderUri;
    if (noteUri) draft = await stampNoteProperties(draft, noteUri);

    let document;
    if (!this.documentUri && this.placeholderUri) {
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
    await this.sendPaneState("Saved locally");
    return { action: "saved", saved: true };
  }

  async trashCurrentNote() {
    if (this.actionPending) return;
    await this.editQueue.catch(() => undefined);
    const document = await this.currentDocument();
    if (!document) return;
    const uri = document.uri;
    const relativePath = vscode.workspace.asRelativePath(uri, false);
    const choice = await vscode.window.showWarningMessage(
      `Move note "${relativePath}" to Trash?`,
      {
        modal: true,
        detail: "Only the local sidecar moves to the operating-system Trash.",
      },
      "Move to Trash",
    );
    if (choice !== "Move to Trash") return;
    this.actionPending = true;
    let finalStatus = "";
    await this.sendPaneState("Moving local note to Trash…");
    try {
      if (!(await document.save())) {
        throw structuredError("notes_save_failed", "the note could not be saved before moving it to Trash", [
          "Resolve the file-system error and retry",
        ]);
      }
      const deleted = await trashNotesLocally([uri]);
      if (!deleted) return;
      this.document = undefined;
      this.documentUri = undefined;
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
      finalStatus = "Moved local note to Trash";
    } finally {
      this.actionPending = false;
      await this.sendPaneState(finalStatus);
    }
  }

  async openCurrentTarget() {
    let target = this.sourceUri;
    if (!target && (this.documentUri || this.placeholderUri)) {
      const noteUri = this.documentUri ?? this.placeholderUri;
      const folder = vscode.workspace.getWorkspaceFolder(noteUri);
      const relativePath = folder
        ? vscode.workspace.asRelativePath(noteUri, false).replaceAll("\\", "/")
        : "";
      target = folder ? await resolveTarget(folder, relativePath) : undefined;
    }
    if (!target) return false;
    const stat = await vscode.workspace.fs.stat(target);
    if (stat.type & vscode.FileType.Directory) {
      await vscode.commands.executeCommand("revealInExplorer", target);
    } else {
      await vscode.window.showTextDocument(target);
    }
    return true;
  }

  async onMessage(message) {
    try {
      switch (message.type) {
        case "ready":
          this.ready = true;
          if (this.documentUri || this.placeholderUri) await this.sendInit();
          else await this.followActive();
          break;
        case "commit":
          this.editQueue = this.editQueue.catch(() => undefined).then(() =>
            this.commitDraft(message.text, message.generation),
          );
          await this.editQueue;
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
        case "pane.clear":
        case "pane.delete":
          await this.trashCurrentNote();
          break;
        case "pane.target": {
          await this.openCurrentTarget();
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
      await this.open(vscode.Uri.joinPath(folder.uri, relativePath), {
        reveal: true,
      });
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
        await this.open(uri, { reveal: true });
      } else {
        await openSourceAtHref(uri, payload?.href ?? "");
      }
    }
  }
}
