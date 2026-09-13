import * as vscode from "vscode";
import * as path from "node:path";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import {
  activeWindowResource,
  isNotePath,
  NavigationQueue,
  paneCapabilities,
  preferredWorkspaceFolder,
} from "./model.js";
import { resolveTarget } from "../notes/target.js";
import {
  noteDescriptorForUri,
  notePlaceholderForUri,
} from "../notes/create.js";
import { noteRelationshipsForTarget } from "../notes/relationships.js";
import { openSourceAtHref, openExternalLink, workspaceLinkUri } from "../notes/navigation.js";
import { trashNotesLocally } from "../notes/delete.js";
import { stampNoteProperties } from "../notes/properties.js";
import { parentNoteCandidates } from "../notes/parent-context.js";
import { DisposableScope } from "../lifecycle.js";
import { documentSnapshot, createNoteDocument } from "../notes/operation.js";
import { ClipboardHost } from "../clipboard.js";
import { createNoteHeaderLabel } from "../notes/header-label.js";

export const SECONDARY_VIEW_ID = "aicNotes.secondary";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export class SecondaryNotePane {
  static register(context, ownership) {
    const pane = new SecondaryNotePane(context, ownership);
    const noteWatcher =
      vscode.workspace.createFileSystemWatcher("**/*.note.md");
    const resources = [
      noteWatcher,
      vscode.window.registerWebviewViewProvider(SECONDARY_VIEW_ID, pane, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.window.onDidChangeActiveTextEditor(() => pane.followActive()),
      vscode.window.tabGroups.onDidChangeTabs(() => pane.followActive()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => pane.followActive()),
      vscode.workspace.onDidChangeTextDocument((event) =>
        pane.onDocumentChanged(event),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        pane.onDocumentClosed(document),
      ),
      noteWatcher.onDidCreate(() => pane.onNotesChanged()),
      noteWatcher.onDidDelete(() => pane.onNotesChanged()),
    ];
    for (const resource of resources) pane.scope.add(resource);
    context.subscriptions.push(pane);
    queueMicrotask(() => pane.followActive());
    return pane;
  }

  constructor(context, ownership) {
    this.context = context;
    this.headerLabel = createNoteHeaderLabel();
    this.scope = new DisposableScope();
    this.view = undefined;
    this.document = undefined;
    this.documentUri = undefined;
    this.sourceUri = undefined;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    this.pinned = false;
    this.ready = false;
    this.generation = 0;
    this.relationshipRequest = 0;
    this.draftDirty = false;
    this.draftRevision = 0;
    this.applying = 0;
    this.editQueue = Promise.resolve();
    this.pendingViewState = undefined;
    this.actionPending = false;
    this.suppressFollowing = 0;
    this.navigation = new NavigationQueue();
    this.ownership = ownership;
    this.snapshotRequest = 0;
    this.snapshotWaiters = new Map();
    this.saveWaiters = new Map();
    this.insertionWaiters = new Map();
    this.readyWaiters = new Set();
    this.savingLease = 0;
    this.navigationPaused = false;
    this.editSurface = ownership?.register({
      uri: () => this.document?.uri ?? this.documentUri ?? this.placeholderUri,
      dirty: () =>
        this.draftDirty || this.savingLease > 0 || this.navigationPaused,
      text: () => this.document?.getText() ?? this.placeholderText ?? "",
      probe: () => this.editingSnapshot(),
      notify: (state) =>
        this.view?.webview.postMessage({
          type: "editingState",
          ...state,
          readOnly: state.readOnly || this.navigationPaused,
          relativePath: this.editingPath(),
        }),
    });
  }

  dispose() {
    if (this.scope.disposed) return;
    this.scope.dispose();
    if (this.editSurface) this.ownership.dispose(this.editSurface);
    for (const resolve of this.snapshotWaiters.values()) resolve(null);
    this.snapshotWaiters.clear();
    for (const resolve of this.saveWaiters.values()) resolve(false);
    this.saveWaiters.clear();
    for (const resolve of this.insertionWaiters.values()) resolve(null);
    this.insertionWaiters.clear();
    for (const resolve of this.readyWaiters) resolve(false);
    this.readyWaiters.clear();
  }

  editingPath() {
    const uri = this.documentUri ?? this.placeholderUri;
    return uri
      ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
      : "";
  }

  editingSnapshot() {
    if (!this.view || !this.ready)
      return Promise.resolve({
        text: this.editSurface.text(),
        dirty: this.draftDirty,
      });
    const requestId = `secondary-${++this.snapshotRequest}`;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.snapshotWaiters.delete(requestId);
        resolve(null);
      }, 1500);
      this.snapshotWaiters.set(requestId, (snapshot) => {
        clearTimeout(timeout);
        resolve(snapshot);
      });
      void this.view.webview
        .postMessage({
          type: "editing.probe",
          requestId,
          relativePath: this.editingPath(),
        })
        .then(
          (sent) => {
            if (!sent) {
              this.snapshotWaiters.get(requestId)?.(null);
              this.snapshotWaiters.delete(requestId);
            }
          },
          () => {
            this.snapshotWaiters.get(requestId)?.(null);
            this.snapshotWaiters.delete(requestId);
          },
        );
    });
  }

  async flushDraftBeforeNavigation() {
    if (!this.view || !this.ready) return !this.draftDirty;
    const path = this.editingPath();
    const requestId = `save-${++this.snapshotRequest}`;
    const saved = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.saveWaiters.delete(requestId);
        resolve(false);
      }, 5000);
      this.saveWaiters.set(requestId, (result) => {
        this.saveWaiters.delete(requestId);
        clearTimeout(timeout);
        resolve(result);
      });
      void this.view.webview.postMessage({ type: "draft.saveRequest", requestId, relativePath: path }).then(
        (sent) => { if (!sent) this.saveWaiters.get(requestId)?.(false); },
        () => this.saveWaiters.get(requestId)?.(false),
      );
    });
    await this.editQueue.catch(() => undefined);
    return Boolean(saved && this.editingPath() === path && !this.draftDirty);
  }

  async resolveWebviewView(view) {
    if (this.scope.disposed) return;
    this.viewScope?.dispose();
    const scope = this.scope.child();
    this.viewScope = scope;
    this.view = view;
    const clipboard = new ClipboardHost({
      scope,
      clipboard: vscode.env?.clipboard,
      context: () => ({
        webview: this.view?.webview,
        identity: (this.documentUri ?? this.placeholderUri)?.toString(),
        relativePath: this.editingPath(),
        generation: this.generation,
        hasSurface: Boolean(this.documentUri || this.placeholderUri),
        ready: this.ready,
        readOnly: this.navigationPaused || Boolean(this.editSurface &&
          this.ownership.state(this.editSurface).readOnly),
      }),
    });
    const distRoot = vscode.Uri.joinPath(
      this.context.extensionUri,
      "dist",
      "webview",
    );
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [distRoot],
    };
    scope.add(
      view.webview.onDidReceiveMessage((message) => {
        if (scope.disposed) return;
        if (message?.type === "clipboard.request") {
          // Never enter the save/commit queue for an OS clipboard call.
          void clipboard.handle(message, view.webview);
          return;
        }
        return this.onMessage(message);
      }),
    );
    scope.defer(() => {
      if (this.view !== view) return;
      this.view = undefined;
      this.ready = false;
      for (const resolve of this.snapshotWaiters.values()) resolve(null);
      this.snapshotWaiters.clear();
      for (const resolve of this.saveWaiters.values()) resolve(false);
      this.saveWaiters.clear();
      for (const resolve of this.insertionWaiters.values()) resolve(null);
      this.insertionWaiters.clear();
      for (const resolve of this.readyWaiters) resolve(false);
      this.readyWaiters.clear();
    });
    scope.add(view.onDidDispose(() => scope.dispose()));
    view.webview.html = webviewHtml(
      view.webview,
      distRoot,
      "main.js",
      `<span id="pane-status" class="aic-visually-hidden" role="status" aria-live="polite" aria-atomic="true"></span>
      <div id="pane-empty" class="aic-pane-empty">
        <strong>Open a workspace file</strong>
        <span id="pane-empty-detail">Its note or editable placeholder will appear here.</span>
      </div>
      <div id="editor"></div>
      <footer id="secondary-footer" aria-label="Linked note actions">
        <button id="pane-target" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="source" aria-label="Open source" hidden></button>
        <button id="pane-clear" class="aic-pane-icon cm-aic-icon-button danger" type="button" data-aic-icon="trash" aria-label="Move note to Trash" hidden></button>
        <span class="aic-pane-footer-spacer"></span>
        <span id="editing-status" role="status" aria-live="polite"></span>
        <span id="pane-save-indicator" class="aic-pane-save-indicator" role="img" aria-label="Unsaved changes" hidden></span>
        <button id="pane-pin" class="aic-pane-icon cm-aic-icon-button" type="button" data-aic-icon="pin" aria-label="Pin note" aria-pressed="false"></button>
      </footer>`,
      "aic-secondary-surface",
    );
    if (this.documentUri || this.placeholderUri) await this.sendInit();
    else await this.sendPaneState();
  }

  async focus(preserveFocus = false) {
    if (this.scope.disposed) return;
    try {
      await vscode.commands.executeCommand(`${SECONDARY_VIEW_ID}.focus`, {
        preserveFocus,
      });
    } catch {
      await vscode.commands.executeCommand(
        "workbench.action.focusSecondarySideBar",
      );
    }
  }

  open(uri, options = {}) {
    return this.navigation.enqueue(() => this.openNow(uri, options));
  }

  // Insertion is an editor intent, not a second filesystem writer. The live
  // sidebar draft (or placeholder) owns the text; only explicit Save persists it.
  insertLinkedCode(uri, { sourceUri, reference, selectedText }) {
    return this.navigation.enqueue(async () => {
      if (!(await this.openNow(uri, { pin: false, reveal: true, sourceUri })))
        return null;
      if (!this.ready) {
        const ready = await new Promise((resolve) => {
          const finish = (value) => {
            clearTimeout(timer);
            this.readyWaiters.delete(finish);
            resolve(value);
          };
          const timer = setTimeout(() => finish(false), 1500);
          this.readyWaiters.add(finish);
        });
        if (!ready) return null;
      }
      if (
        this.scope.disposed ||
        !this.view ||
        this.editingPath() !==
          vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
      )
        return null;
      if (
        this.editSurface &&
        !(await this.ownership.activate(this.editSurface))
      ) {
        await this.sendPaneState(
          "Read-only here · finish editing in the other surface",
        );
        return null;
      }
      if (this.scope.disposed || !this.view) return null;
      const lease = this.editSurface
        ? this.ownership.state(this.editSurface).lease
        : undefined;
      const requestId = `insert-${++this.snapshotRequest}`;
      const result = new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.insertionWaiters.delete(requestId);
          resolve(null);
        }, 1500);
        this.insertionWaiters.set(requestId, (value) => {
          clearTimeout(timer);
          resolve(value);
        });
      });
      try {
        const sent = await this.view.webview.postMessage({
          type: "linkedCode.insert",
          requestId,
          expiresAt: Date.now() + 1500,
          relativePath: this.editingPath(),
          generation: this.generation,
          lease,
          reference,
          selectedText,
        });
        if (sent) return await result;
        return null;
      } finally {
        this.insertionWaiters.get(requestId)?.(null);
        this.insertionWaiters.delete(requestId);
      }
    });
  }

  async beginNavigation(retried = false) {
    if (this.scope.disposed || this.actionPending) return null;
    if (this.draftDirty && !(await this.flushDraftBeforeNavigation())) {
      await this.sendPaneState("Save failed · keep this note open and use Save to retry");
      return null;
    }
    const previousPath = this.editingPath();
    const revision = this.draftRevision;
    const expectedText = this.document?.getText() ?? this.placeholderText ?? "";
    const isCurrent = () =>
      !this.scope.disposed &&
      !this.actionPending &&
      this.editingPath() === previousPath &&
      this.draftRevision === revision &&
      !this.draftDirty &&
      this.savingLease === 0;
    const release = () => {
      this.navigationPaused = false;
      if (this.editSurface) void this.ownership.changed(this.editSurface);
      else
        void this.view?.webview.postMessage({
          type: "editingState",
          relativePath: this.editingPath(),
          readOnly: false,
        });
    };
    this.navigationPaused = true;
    this.ownership?.notify();
    // Pausing before filesystem work catches draft messages still travelling
    // from the old client. Keep its identity until the destination is ready.
    let snapshot;
    try {
      snapshot =
        previousPath && this.ready
          ? await this.editingSnapshot()
          : { text: expectedText, dirty: this.draftDirty };
    } catch {
      snapshot = null;
    }
    if (
      !snapshot ||
      snapshot.dirty ||
      snapshot.text !== expectedText ||
      !isCurrent()
    ) {
      release();
      if (!retried && snapshot?.dirty && await this.flushDraftBeforeNavigation())
        return this.beginNavigation(true);
      await this.sendPaneState("Unsaved · press Ctrl+S before switching notes");
      return null;
    }
    return { isCurrent, release };
  }

  async stageNote(uri, sourceUri) {
    if (await exists(uri)) {
      const document =
        this.document?.uri.toString() === uri.toString() &&
        !this.document.isClosed
          ? this.document
          : await vscode.workspace.openTextDocument(uri);
      return { document, sourceUri };
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const relativePath = folder
      ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
      : "";
    const target =
      sourceUri ?? (folder ? await resolveTarget(folder, relativePath) : null);
    if (!target)
      throw structuredError("notes_missing", `${uri.fsPath} no longer exists`, [
        "Restore its source or select another workspace item",
      ]);
    const placeholder = await notePlaceholderForUri(target);
    return {
      sourceUri: sourceUri ?? target,
      placeholderUri: placeholder.noteUri,
      placeholderText: placeholder.text,
    };
  }

  async adoptNote(next, selection) {
    this.sourceUri = next.sourceUri;
    this.document = next.document;
    this.documentUri = next.document?.uri;
    this.placeholderUri = next.placeholderUri;
    this.placeholderText = next.placeholderText;
    this.pendingViewState = { selection };
    this.generation++;
    await this.sendInit();
  }

  async openNow(uri, { pin, reveal = true, sourceUri, selection } = {}) {
    if (this.scope.disposed || this.actionPending) return false;
    if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) {
      throw structuredError(
        "notes_not_sidecar",
        `${uri?.fsPath ?? "resource"} is not a *.note.md sidecar`,
        ["Choose a sidecar note"],
      );
    }
    const currentUri = this.documentUri ?? this.placeholderUri;
    if (this.draftDirty && currentUri?.toString() === uri.toString()) {
      if (typeof pin === "boolean") this.pinned = pin;
      await this.sendPaneState();
      await this.finishNoteRouting(uri, reveal);
      return true;
    }
    const transition = await this.beginNavigation();
    if (!transition) return false;
    try {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = folder
        ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
        : "";
      const nextSource =
        sourceUri ??
        (folder ? await resolveTarget(folder, relativePath) : undefined);
      const next = await this.stageNote(uri, nextSource);
      if (!transition.isCurrent()) {
        await this.sendPaneState(
          "Unsaved · press Ctrl+S before switching notes",
        );
        return false;
      }
      if (typeof pin === "boolean") this.pinned = pin;
      await this.adoptNote(next, selection);
      await this.finishNoteRouting(uri, reveal);
      return true;
    } finally {
      transition.release();
    }
  }

  async finishNoteRouting(uri, reveal) {
    this.suppressFollowing++;
    try {
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

  async currentDocument() {
    const uri = this.documentUri ?? this.document?.uri;
    if (!uri) return undefined;
    if (!(await exists(uri))) {
      if (await this.recoverPlaceholder(uri)) {
        await this.sendInit();
        return undefined;
      }
      this.document = undefined;
      this.documentUri = undefined;
      return undefined;
    }
    if (
      !this.document ||
      this.document.isClosed ||
      this.document.uri.toString() !== uri.toString()
    ) {
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

  async followTargetNow(
    uri,
    {
      force = false,
      preserveFocus = true,
      isCurrent = () => true,
      allowPlaceholder = true,
    } = {},
  ) {
    if (
      !uri ||
      uri.scheme !== "file" ||
      isNotePath(uri.path) ||
      (this.pinned && !force) ||
      !isCurrent()
    )
      return false;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return false;
    const descriptor = await noteDescriptorForUri(uri);
    if (!isCurrent() || (this.pinned && !force)) return false;
    const noteUri = descriptor.noteUri;
    const currentUri = this.documentUri ?? this.placeholderUri;
    if (this.draftDirty && currentUri?.toString() === noteUri.toString()) {
      await this.focus(preserveFocus);
      return true;
    }
    const transition = await this.beginNavigation();
    if (!transition) return false;
    try {
      const next = await this.stageNote(noteUri, uri);
      if (!isCurrent() || (this.pinned && !force)) return false;
      if (!allowPlaceholder && next.placeholderUri) return false;
      if (!transition.isCurrent()) {
        await this.sendPaneState(
          "Unsaved · press Ctrl+S before following another file",
        );
        return false;
      }
      if (force) this.pinned = false;
      // Repeated tab/watcher events for one parent must not reset its selection
      // or reinitialize the editor. A placeholder becoming a file is a transition.
      if (
        next.document === this.document &&
        next.placeholderUri?.toString() === this.placeholderUri?.toString() &&
        next.sourceUri?.toString() === this.sourceUri?.toString()
      ) {
        await this.sendPaneState();
        await this.focus(preserveFocus);
        return true;
      }
      await this.adoptNote(next);
      await this.focus(preserveFocus);
      return true;
    } finally {
      transition.release();
    }
  }

  followActive() {
    // Inspect the active tab when this queued operation actually runs. A slow
    // source lookup must not overtake a newer main-note selection.
    return this.navigation.enqueue(() => this.followActiveNow());
  }

  activeMainResource() {
    return activeWindowResource(vscode.window);
  }

  async followActiveNow() {
    if (this.scope.disposed || this.suppressFollowing > 0 || this.pinned)
      return false;
    const uri = this.activeMainResource();
    const isCurrent = () =>
      this.suppressFollowing === 0 &&
      !this.pinned &&
      this.activeMainResource()?.toString() === uri?.toString();
    if (!uri) {
      const folder = preferredWorkspaceFolder(
        [this.sourceUri, this.documentUri, this.placeholderUri],
        vscode.workspace.workspaceFolders,
        (candidate) => vscode.workspace.getWorkspaceFolder(candidate),
      );
      return folder
        ? this.followTargetNow(folder.uri, { preserveFocus: true, isCurrent })
        : false;
    }
    if (isNotePath(uri.path)) {
      // Keep the note in main; show the nearest existing parent beside it.
      // Direct calls are intentional: this operation already owns the queue.
      for await (const candidate of parentNoteCandidates(uri)) {
        if (!isCurrent()) return false;
        let followed;
        try {
          followed = await this.followTargetNow(candidate.targetUri, {
            preserveFocus: true,
            isCurrent,
            allowPlaceholder: candidate.isProject,
          });
        } catch (error) {
          if (!isCurrent()) return false;
          // Removal can race the document open, not just its preceding stat.
          if (
            !candidate.isProject &&
            (!(await exists(candidate.noteUri)) ||
              !(await exists(candidate.targetUri)))
          )
            continue;
          throw error;
        }
        if (followed || !isCurrent() || this.draftDirty) return followed;
        // If the candidate vanished during IO, continue upward, never create
        // an intermediate folder placeholder. Other refusals preserve the draft.
        if (candidate.isProject || (await exists(candidate.noteUri)))
          return false;
      }
      return false;
    }
    return this.followTargetNow(uri, { isCurrent });
  }

  async onNotesChanged() {
    if (this.scope.disposed) return;
    if (isNotePath(this.activeMainResource()?.path)) await this.followActive();
    await this.refreshRelationships();
  }

  onDocumentChanged(event) {
    if (
      this.scope.disposed ||
      !this.documentUri ||
      event.document.uri.toString() !== this.documentUri.toString()
    )
      return;
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
    const document = this.documentUri
      ? await this.currentDocument()
      : undefined;
    const uri = document?.uri ?? this.placeholderUri;
    const text = document?.getText() ?? this.placeholderText;
    const view = this.view;
    const generation = this.generation;
    const revision = this.draftRevision;
    const current = () =>
      !this.scope.disposed &&
      view === this.view &&
      generation === this.generation &&
      revision === this.draftRevision &&
      uri?.toString() === (this.documentUri ?? this.placeholderUri)?.toString();
    if (!uri || typeof text !== "string") {
      await this.sendPaneState();
      return;
    }
    const relativePath = vscode.workspace
      .asRelativePath(uri, false)
      .replaceAll("\\", "/");
    let relationshipTarget = this.sourceUri;
    if (!relationshipTarget) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      relationshipTarget = folder
        ? await resolveTarget(folder, relativePath)
        : undefined;
    }
    const relationships = relationshipTarget
      ? await noteRelationshipsForTarget(relationshipTarget)
      : [];
    const viewState = this.pendingViewState;
    if (!current()) return;
    if (this.editSurface) await this.ownership.activate(this.editSurface);
    if (!current()) return;
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
      ...(this.editSurface ? this.ownership.state(this.editSurface) : {}),
      readOnly:
        this.navigationPaused ||
        (this.editSurface && this.ownership.state(this.editSurface).readOnly),
    });
    this.pendingViewState = undefined;
    await this.sendPaneState();
  }

  async refreshRelationships() {
    if (
      !this.view ||
      !this.ready ||
      (!this.documentUri && !this.placeholderUri)
    )
      return;
    const uri = this.documentUri ?? this.placeholderUri;
    const generation = this.generation;
    const view = this.view;
    const request = ++this.relationshipRequest;
    let target = this.sourceUri;
    if (!target && uri) {
      const folder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = folder
        ? vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
        : "";
      target = folder ? await resolveTarget(folder, relativePath) : undefined;
    }
    const relationships = target
      ? await noteRelationshipsForTarget(target)
      : [];
    if (
      view !== this.view ||
      generation !== this.generation ||
      request !== this.relationshipRequest ||
      uri?.toString() !== (this.documentUri ?? this.placeholderUri)?.toString()
    )
      return;
    await this.view.webview.postMessage({
      type: "relationships",
      relationships,
    });
  }

  async sendPaneState(status = "") {
    if (this.scope.disposed) return;
    if (this.editSurface) void this.ownership.changed(this.editSurface);
    if (!this.view) return;
    const relativePath = this.documentUri
      ? vscode.workspace
          .asRelativePath(this.documentUri, false)
          .replaceAll("\\", "/")
      : "";
    const candidatePath = this.placeholderUri
      ? vscode.workspace
          .asRelativePath(this.placeholderUri, false)
          .replaceAll("\\", "/")
      : "";
    const displayPath = relativePath || candidatePath;
    const title = displayPath
      ? path.posix.basename(displayPath)
      : "Linked Note";
    const capabilities = paneCapabilities({
      hasDocument: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSource: Boolean(this.sourceUri),
    });
    this.view.title = title;
    this.view.description = this.headerLabel(this.document?.getText() ?? "");
    await this.view.webview.postMessage({
      type: "paneState",
      title,
      pinned: this.pinned,
      hasNote: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSurface: capabilities.hasSurface,
      canOpenTarget: capabilities.canOpenTarget,
      canTrash: capabilities.canTrash,
      canPin: capabilities.canPin,
      candidatePath,
      status,
      actionPending: this.actionPending,
    });
  }

  async commitDraft(
    text,
    generation,
    requestId,
    relativePath,
    lease,
    view = this.view,
  ) {
    this.savingLease++;
    let draft = String(text ?? "");
    let replied = false;
    const reply = async (saved) => {
      if (replied) return;
      replied = true;
      await view?.webview.postMessage({
        type: "committed",
        text: draft,
        generation: this.generation,
        saved,
        requestId,
        relativePath,
      });
    };
    try {
      const submittedRevision = this.draftRevision;
      const noteUri = this.documentUri ?? this.placeholderUri;
      const unchanged = documentSnapshot(this.document);
      const current = () =>
        !this.scope.disposed &&
        this.view === view &&
        !this.actionPending &&
        (this.documentUri ?? this.placeholderUri)?.toString() ===
          noteUri?.toString() &&
        this.generation === generation &&
        unchanged() &&
        (!this.editSurface || this.ownership.accepts(this.editSurface, lease));
      const stale = async () => {
        await reply(false);
        await this.sendPaneState(
          "File or editing context changed · draft kept in the editor",
        );
        return { action: "stale-draft", skipped: true };
      };
      if (this.scope.disposed || this.view !== view) return await stale();
      const activePath = noteUri
        ? vscode.workspace.asRelativePath(noteUri, false).replaceAll("\\", "/")
        : "";
      if (
        !Number.isSafeInteger(requestId) ||
        requestId <= 0 ||
        !activePath ||
        relativePath !== activePath
      ) {
        await reply(false);
        return { action: "wrong-note", skipped: true };
      }
      if (generation !== this.generation) {
        await reply(false);
        await this.sendPaneState(
          "File changed externally · draft kept in the editor",
        );
        return { action: "stale-draft", skipped: true };
      }

      if (
        this.editSurface &&
        !this.ownership.accepts(this.editSurface, lease)
      ) {
        await reply(false);
        await this.sendPaneState(
          "Read-only here · finish saving the note in its other editor",
        );
        return { action: "not-owner", skipped: true };
      }

      if (
        !this.documentUri &&
        this.placeholderUri &&
        draft === this.placeholderText
      ) {
        await reply(true);
        await this.sendPaneState("Not saved · unchanged placeholder");
        return { action: "placeholder", skipped: true };
      }

      if (noteUri) draft = await stampNoteProperties(draft, noteUri);
      if (!current()) return await stale();

      let document;
      if (!this.documentUri && this.placeholderUri) {
        const uri = this.placeholderUri;
        if (await exists(uri)) {
          await reply(false);
          await this.sendPaneState(
            "Note appeared on disk · draft kept in the editor",
          );
          return { action: "appeared", skipped: true };
        }
        if (!current()) return await stale();
        try {
          document = await createNoteDocument(uri, draft, current);
          if (!document) return await stale();
          if (!current()) return await stale();
        } catch {
          await reply(false);
          await this.sendPaneState("Save failed · draft kept in the editor");
          return { action: "save-failed", skipped: true };
        }
        this.documentUri = uri;
        this.document = document;
        this.placeholderUri = undefined;
        this.placeholderText = undefined;
        document = this.document;
        await vscode.commands.executeCommand("aicNotes.refreshTree");
      } else {
        if (this.documentUri && !(await exists(this.documentUri))) {
          if (!current()) return await stale();
          try {
            const created = await createNoteDocument(
              this.documentUri,
              draft,
              current,
            );
            if (!created) return await stale();
            if (!current()) return await stale();
            this.document = created;
            document = this.document;
            await vscode.commands.executeCommand("aicNotes.refreshTree");
          } catch {
            await reply(false);
            await this.sendPaneState("Save failed · draft kept in the editor");
            return { action: "save-failed", skipped: true };
          }
        } else {
          document = await this.currentDocument();
        }
        if (!document) {
          await reply(false);
          await this.sendPaneState(
            "Note is unavailable · draft kept in the editor",
          );
          return { action: "missing", skipped: true };
        }
        if (document.getText() !== draft) {
          if (!current()) return await stale();
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            document.uri,
            new vscode.Range(
              document.positionAt(0),
              document.positionAt(document.getText().length),
            ),
            draft,
          );
          this.applying++;
          try {
            if (!(await vscode.workspace.applyEdit(edit))) {
              await reply(false);
              await this.sendPaneState(
                "Save failed · draft kept in the editor",
              );
              return { action: "save-failed", skipped: true };
            }
            this.document = document;
          } finally {
            this.applying--;
          }
        }
      }

      let saved = false;
      if (
        this.scope.disposed ||
        this.view !== view ||
        document.getText() !== draft ||
        (this.editSurface && !this.ownership.accepts(this.editSurface, lease))
      )
        return await stale();
      try {
        saved = await document.save();
      } catch {
        // A sidecar can disappear between the existence check and save. The
        // webview remains the draft owner; keep it dirty and let the next
        // Ctrl+S retry instead of surfacing a disruptive host error.
      }
      await reply(saved);
      if (!saved) {
        await this.sendPaneState("Save failed · draft kept in the editor");
        return { action: "save-failed", skipped: true };
      }
      if (this.draftRevision === submittedRevision) this.draftDirty = false;
      await this.sendPaneState();
      return { action: "saved", saved: true };
    } catch (error) {
      // Every request reaches one terminal reply, including failures while
      // stamping, reopening, refreshing or applying the document. A later
      // status failure cannot send a contradictory reply after a saved result.
      await reply(false);
      throw error;
    } finally {
      this.savingLease--;
      if (this.editSurface) void this.ownership.changed(this.editSurface);
    }
  }

  async trashCurrentNote(lease) {
    if (this.scope.disposed || this.actionPending) return;
    this.actionPending = true;
    const view = this.view;
    const uri = this.documentUri;
    const generation = this.generation;
    const revision = this.draftRevision;
    let finalStatus = "";
    try {
      await this.editQueue.catch(() => undefined);
      const document = await this.currentDocument();
      if (!document || !uri) return;
      const unchanged = documentSnapshot(document);
      const current = () =>
        !this.scope.disposed &&
        this.view === view &&
        this.documentUri?.toString() === uri.toString() &&
        this.generation === generation &&
        this.draftRevision === revision &&
        unchanged() &&
        (!this.editSurface || this.ownership.accepts(this.editSurface, lease));
      if (!current()) return;
      if (document.isDirty || this.draftDirty) {
        finalStatus = "Unsaved · press Ctrl+S before moving the note to Trash";
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        `Move note "${vscode.workspace.asRelativePath(uri, false)}" to Trash?`,
        {
          modal: true,
          detail: "Only the local sidecar moves to the operating-system Trash.",
        },
        "Move to Trash",
      );
      if (choice !== "Move to Trash") return;
      if (!current()) {
        finalStatus = "Note or editing owner changed · nothing was deleted";
        return;
      }
      this.savingLease++;
      let deleted;
      try {
        deleted = await trashNotesLocally([uri], { beforeDelete: current });
      } finally {
        this.savingLease--;
      }
      if (!deleted || this.scope.disposed) return;
      this.document = undefined;
      this.documentUri = undefined;
      this.pendingViewState = undefined;
      if (this.sourceUri) {
        const placeholder = await notePlaceholderForUri(this.sourceUri);
        if (this.scope.disposed) return;
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
      if (!this.scope.disposed) await this.sendPaneState(finalStatus);
    }
  }

  openSourceForNote(noteUri) {
    return this.navigation.enqueue(async () => {
      if (!noteUri || noteUri.scheme !== "file" || !isNotePath(noteUri.path)) {
        throw structuredError(
          "notes_not_sidecar",
          "Open source requires a file-backed .note.md note",
          ["Choose a note, then Open source"],
        );
      }
      const folder = vscode.workspace.getWorkspaceFolder(noteUri);
      const relativePath = folder
        ? vscode.workspace.asRelativePath(noteUri, false).replaceAll("\\", "/")
        : "";
      const target = folder
        ? await resolveTarget(folder, relativePath, {
            requireUnambiguous: true,
          })
        : undefined;
      if (!target)
        throw structuredError(
          "notes_orphan",
          `${relativePath || noteUri.fsPath} has no existing source`,
          ["Restore the source or keep editing the standalone note"],
        );
      const stat = await vscode.workspace.fs.stat(target);
      const document = vscode.workspace.textDocuments?.find(
        (entry) => entry.uri.toString() === noteUri.toString(),
      );
      if (document?.isDirty) {
        throw structuredError(
          "notes_unsaved",
          "Save the note in its main editor before opening the source",
          ["Press Ctrl+S in the note, then Open source"],
        );
      }
      this.suppressFollowing++;
      try {
        // Resolve/validate first, then acquire the sidebar before navigating.
        // A different unsaved sidebar draft blocks this explicit pair action.
        if (
          !(await this.openNow(noteUri, {
            sourceUri: target,
            reveal: false,
            pin: false,
          }))
        )
          return false;
        if (stat.type & vscode.FileType.Directory) {
          await vscode.commands.executeCommand("revealInExplorer", target);
        } else {
          await vscode.commands.executeCommand("vscode.open", target, {
            preview: false,
          });
        }
        await this.focus(true);
        return true;
      } finally {
        this.suppressFollowing--;
      }
    });
  }

  openCurrentTarget() {
    return this.openSourceForNote(this.documentUri ?? this.placeholderUri);
  }

  async onMessage(message) {
    if (this.scope.disposed) return;
    // Capture before queueing: a replacement view may reuse path, generation
    // and request IDs but must never inherit an old view's pending command.
    const view = this.view;
    try {
      switch (message.type) {
        case "linkedCode.result": {
          const resolve = this.insertionWaiters.get(message.requestId);
          this.insertionWaiters.delete(message.requestId);
          resolve?.(
            message.accepted ? { created: Boolean(message.created) } : null,
          );
          break;
        }
        case "editing.snapshot": {
          const resolve = this.snapshotWaiters.get(message.requestId);
          if (!resolve) break;
          this.snapshotWaiters.delete(message.requestId);
          resolve({
            text: String(message.text ?? ""),
            dirty: Boolean(message.dirty),
          });
          break;
        }
        case "editing.request":
          if (this.editSurface && message.relativePath === this.editingPath())
            await this.ownership.activate(this.editSurface);
          break;
        case "ready":
          this.ready = true;
          if (this.documentUri || this.placeholderUri) await this.sendInit();
          else await this.followActive();
          for (const resolve of this.readyWaiters) resolve(true);
          this.readyWaiters.clear();
          break;
        case "commit":
          this.editQueue = this.editQueue
            .catch(() => undefined)
            .then(() =>
              this.commitDraft(
                message.text,
                message.generation,
                message.requestId,
                message.relativePath,
                message.lease,
                view,
              ),
            );
          await this.editQueue;
          break;
        case "undo":
        case "redo":
          if (
            this.editSurface &&
            !this.ownership.accepts(this.editSurface, message.lease)
          )
            break;
          await vscode.commands.executeCommand(message.type);
          break;
        case "pane.pin":
          this.pinned = !this.pinned;
          await this.sendPaneState();
          if (!this.pinned) await this.followActive();
          break;
        case "pane.clear":
        case "pane.delete":
          await this.trashCurrentNote(message.lease);
          break;
        case "pane.target": {
          await this.openCurrentTarget();
          break;
        }
        case "bus":
          await this.routeBus(message);
          break;
        case "toast":
          vscode.window.showWarningMessage(
            `AIC Notes — ${String(message.message ?? "Markdown warning")}`,
          );
          break;
        case "draft.externalConflict":
          await this.sendPaneState(
            "File changed externally · current draft was not replaced",
          );
          break;
        case "draft.saveResult": {
          const resolve = this.saveWaiters.get(message.requestId);
          if (!resolve) break;
          this.saveWaiters.delete(message.requestId);
          const saved = message.relativePath === this.editingPath() && message.saved === true;
          resolve?.(saved);
          break;
        }
        case "draft.state": {
          const uri = this.documentUri ?? this.placeholderUri;
          if (
            !uri ||
            message.relativePath !==
              vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/")
          )
            break;
          this.draftRevision++;
          this.draftDirty = Boolean(message.dirty || message.pending);
          await this.sendPaneState();
          break;
        }
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
    if (
      topic === "note.open" &&
      (this.documentUri || this.placeholderUri) &&
      payload?.path
    ) {
      const baseUri = this.documentUri ?? this.placeholderUri;
      const folder = baseUri
        ? vscode.workspace.getWorkspaceFolder(baseUri)
        : undefined;
      if (!folder) return;
      const relativePath = String(payload.path).replaceAll("\\", "/");
      if (
        !relativePath.endsWith(".note.md") ||
        relativePath.startsWith("/") ||
        relativePath
          .split("/")
          .some((segment) => !segment || segment === "." || segment === "..")
      )
        return;
      const uri = workspaceLinkUri(folder, relativePath);
      if (!uri) return;
      await this.open(uri, {
        reveal: true,
      });
      return;
    }
    if (
      topic === "file.open" &&
      (this.documentUri || this.placeholderUri) &&
      payload?.path
    ) {
      const document = this.documentUri
        ? await this.currentDocument()
        : undefined;
      const baseUri = document?.uri ?? this.placeholderUri;
      if (!baseUri) return;
      const folder = vscode.workspace.getWorkspaceFolder(baseUri);
      if (!folder) return;
      const uri = workspaceLinkUri(folder, payload.path);
      if (!uri) return;
      if (isNotePath(uri.path)) {
        await this.open(uri, { reveal: true });
      } else {
        await openSourceAtHref(uri, payload?.href ?? "");
      }
    }
  }
}
