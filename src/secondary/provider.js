import { utf8Length } from "../host-runtime.js";
import {
  resourceReadOnly,
  assertWritableResource,
  workspaceFolderFor,
} from "../notes/resources.js";
import * as vscode from "vscode";
import * as path from "../notes/uri-path.js";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError } from "../errors.js";
import {
  activeWindowResource,
  NavigationQueue,
  appendDraftPages,
  mergeDraftPages,
  pageTargetFor,
  preferredWorkspaceFolder,
  projectNoteName,
} from "./model.js";
import {
  openSourceAtHref,
  openExternalLink,
  openPageTarget,
  workspaceLinkUri,
} from "../notes/navigation.js";
import { DisposableScope } from "../lifecycle.js";
import { documentSnapshot, createNoteDocument } from "../notes/operation.js";
import { ClipboardHost } from "../clipboard.js";

export const SECONDARY_VIEW_ID = "aicNotes.secondary";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// One note per project: `<workspace folder>/<folder name>.note.md`. The pane
// shows the page of that note bound to the active file (`--- <project-relative
// path>`) and the whole note when the note itself, or no project file, is active. The
// note text stays one document: switching files only moves the page focus.
const CONFLICT_EXIT =
  "Copy your text, then use Discard my changes and reload, or undo the other change and press Ctrl+S.";

export class SecondaryNotePane {
  static register(context, ownership) {
    const pane = new SecondaryNotePane(context, ownership);
    const follow = () => void pane.followActive().catch(() => undefined);
    const noteWatcher = vscode.workspace.createFileSystemWatcher(
      "**/*.note.md",
    );
    const resources = [
      noteWatcher,
      vscode.window.registerWebviewViewProvider(SECONDARY_VIEW_ID, pane, {
        webviewOptions: { retainContextWhenHidden: true },
      }),
      vscode.window.onDidChangeActiveTextEditor(follow),
      vscode.window.tabGroups.onDidChangeTabs(follow),
      vscode.window.tabGroups.onDidChangeTabGroups(follow),
      vscode.workspace.onDidChangeTextDocument((event) =>
        pane.onDocumentChanged(event),
      ),
      vscode.workspace.onDidCloseTextDocument((document) =>
        pane.onDocumentClosed(document),
      ),
      // The note appearing or disappearing on disk swaps file and placeholder.
      noteWatcher.onDidCreate(follow),
      noteWatcher.onDidDelete(follow),
    ];
    for (const resource of resources) pane.scope.add(resource);
    context.subscriptions.push(pane);
    queueMicrotask(follow);
    return pane;
  }

  constructor(context, ownership) {
    this.context = context;
    this.scope = new DisposableScope();
    this.view = undefined;
    this.folder = undefined;
    this.document = undefined;
    this.documentUri = undefined;
    this.placeholderUri = undefined;
    this.placeholderText = undefined;
    // Page target shown alone; null shows the whole note as cards.
    this.focusTarget = null;
    this.ready = false;
    this.generation = 0;
    this.draftDirty = false;
    this.draftRevision = 0;
    this.applying = 0;
    this.editQueue = Promise.resolve();
    this.navigation = new NavigationQueue();
    this.ownership = ownership;
    this.snapshotRequest = 0;
    this.snapshotWaiters = new Map();
    this.saveWaiters = new Map();
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
          readOnly:
            resourceReadOnly(this.documentUri ?? this.placeholderUri) ||
            state.readOnly ||
            this.navigationPaused,
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
  }

  // Folder-relative, so it is also the base for relative links in the note.
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
      void this.view.webview
        .postMessage({
          type: "draft.saveRequest",
          requestId,
          relativePath: path,
        })
        .then(
          (sent) => {
            if (!sent) this.saveWaiters.get(requestId)?.(false);
          },
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
        readOnly:
          resourceReadOnly(this.documentUri ?? this.placeholderUri) ||
          this.navigationPaused ||
          Boolean(
            this.editSurface && this.ownership.state(this.editSurface).readOnly,
          ),
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
    });
    scope.add(view.onDidDispose(() => scope.dispose()));
    view.webview.html = webviewHtml(
      view.webview,
      distRoot,
      "main.js",
      `<span id="pane-status" class="aic-visually-hidden" role="status" aria-live="polite" aria-atomic="true"></span>
      <div id="pane-empty" class="aic-pane-empty">
        <strong>Open a workspace file</strong>
        <span id="pane-empty-detail">Its page in the project note &lt;folder name&gt;.note.md will appear here.</span>
      </div>
      <div id="editor"></div>
      <footer id="secondary-footer" aria-label="Linked note actions">
        <span class="aic-pane-footer-spacer"></span>
        <span id="editing-status" role="status" aria-live="polite"></span>
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

  async beginNavigation(retried = false) {
    if (this.scope.disposed) return null;
    if (this.draftDirty && !(await this.flushDraftBeforeNavigation())) {
      await this.sendPaneState(
        "Save failed · keep this note open and use Save to retry",
      );
      return null;
    }
    const previousPath = this.editingPath();
    const revision = this.draftRevision;
    const expectedText = this.document?.getText() ?? this.placeholderText ?? "";
    const isCurrent = () =>
      !this.scope.disposed &&
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
          readOnly: resourceReadOnly(this.documentUri ?? this.placeholderUri),
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
      if (
        !retried &&
        snapshot?.dirty &&
        (await this.flushDraftBeforeNavigation())
      )
        return this.beginNavigation(true);
      await this.sendPaneState("Unsaved · press Ctrl+S before switching notes");
      return null;
    }
    return { isCurrent, release };
  }

  async stageNote(uri) {
    if (await exists(uri)) {
      try {
        const document =
          this.document?.uri.toString() === uri.toString() &&
          !this.document.isClosed
            ? this.document
            : await vscode.workspace.openTextDocument(uri);
        return { document };
      } catch (error) {
        // Removal can race the document open, not just its preceding stat.
        if (await exists(uri)) throw error;
      }
    }
    // No note file yet: an empty in-memory document. Viewing writes nothing;
    // the first saved edit creates the file (see commitDraft).
    return { placeholderUri: uri, placeholderText: "" };
  }

  async adoptNote(next) {
    this.folder = next.folder;
    this.document = next.document;
    this.documentUri = next.document?.uri;
    this.placeholderUri = next.placeholderUri;
    this.placeholderText = next.placeholderText;
    this.focusTarget = next.focusTarget ?? null;
    this.generation++;
    await this.sendInit();
  }

  // Same note, other file: move the page focus only. The document and its
  // draft stay as they are and nothing is written; the webview empties its
  // undo history, so undo cannot reach the page that was focused before.
  async refocus(target) {
    if (target === this.focusTarget) return;
    this.focusTarget = target;
    await this.view?.webview.postMessage({
      type: "page.focus",
      relativePath: this.editingPath(),
      target,
    });
    await this.sendPaneState();
  }

  async currentDocument() {
    const uri = this.documentUri ?? this.document?.uri;
    if (!uri) return undefined;
    if (!(await exists(uri))) {
      // The note was deleted while shown. An unsaved draft stays where it is;
      // otherwise the pane returns to the empty placeholder for that note.
      if (this.draftDirty) return undefined;
      this.document = undefined;
      this.documentUri = undefined;
      this.placeholderUri = uri;
      this.placeholderText = "";
      this.generation++;
      await this.sendInit();
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

  followActive(options) {
    // Inspect the active tab when this queued operation actually runs. A slow
    // lookup must not overtake a newer main-editor selection.
    return this.navigation.enqueue(() => this.followActiveNow(options));
  }

  activeMainResource() {
    return activeWindowResource(vscode.window);
  }

  async followActiveNow({ preserveFocus = true } = {}) {
    if (this.scope.disposed) return false;
    const active = this.activeMainResource();
    const isCurrent = () =>
      !this.scope.disposed &&
      this.activeMainResource()?.toString() === active?.toString();
    // A file picks its own workspace folder. Anything else (the note itself,
    // a settings tab, a file outside the workspace) shows a whole note.
    const own = active ? workspaceFolderFor(active) : undefined;
    const folder =
      own ??
      preferredWorkspaceFolder(
        [this.documentUri ?? this.placeholderUri],
        vscode.workspace.workspaceFolders,
        (candidate) => workspaceFolderFor(candidate),
      );
    if (!folder) return false;
    const noteName = projectNoteName(folder);
    if (!noteName) return false;
    const noteUri = vscode.Uri.joinPath(folder.uri, noteName);
    const target = own ? pageTargetFor(own, active) : null;
    const shown = this.documentUri ?? this.placeholderUri;
    if (shown?.toString() === noteUri.toString()) {
      const onDisk = await exists(noteUri);
      if (!isCurrent()) return false;
      // An unsaved draft is never replaced; saving reports a changed file.
      if (
        this.draftDirty ||
        this.savingLease > 0 ||
        Boolean(this.documentUri) === onDisk
      ) {
        await this.refocus(target);
        await this.focus(preserveFocus);
        return true;
      }
    }
    // Another workspace folder's note, or this note appeared/vanished on disk.
    const transition = await this.beginNavigation();
    if (!transition) return false;
    try {
      const next = await this.stageNote(noteUri);
      if (!isCurrent()) return false;
      if (!transition.isCurrent()) {
        await this.sendPaneState(
          "Unsaved · press Ctrl+S before following another file",
        );
        return false;
      }
      await this.adoptNote({ ...next, folder, focusTarget: target });
      await this.focus(preserveFocus);
      return true;
    } finally {
      transition.release();
    }
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
    const relativePath = this.editingPath();
    if (this.editSurface) await this.ownership.activate(this.editSurface);
    if (!current()) return;
    this.draftDirty = false;
    await this.view.webview.postMessage({
      type: "init",
      text,
      generation: this.generation,
      relativePath,
      resourceUri: (this.documentUri ?? this.placeholderUri)?.toString() ?? "",
      surface: "secondary",
      placeholder: !document,
      focus: this.focusTarget,
      ...(this.editSurface ? this.ownership.state(this.editSurface) : {}),
      readOnly:
        resourceReadOnly(this.documentUri ?? this.placeholderUri) ||
        this.navigationPaused ||
        (this.editSurface && this.ownership.state(this.editSurface).readOnly),
    });
    await this.sendPaneState();
  }

  async sendPaneState(status = "", discard = false) {
    if (this.scope.disposed) return;
    if (this.editSurface) void this.ownership.changed(this.editSurface);
    if (!this.view) return;
    const hasSurface = Boolean(this.documentUri || this.placeholderUri);
    const title = this.focusTarget
      ? path.posix.basename(this.focusTarget)
      : hasSurface
        ? path.posix.basename((this.documentUri ?? this.placeholderUri).path)
        : "Linked Note";
    this.view.title = title;
    // Keep filesystem timestamps as host metadata; the compact header shows only
    // the note identity and never repeats created/updated dates.
    this.view.description = undefined;
    await this.view.webview.postMessage({
      type: "paneState",
      title,
      hasNote: Boolean(this.documentUri),
      hasPlaceholder: Boolean(this.placeholderUri),
      hasSurface,
      status,
      // A refused merge: the pane offers Discard my changes and reload.
      discard,
    });
  }

  async commitDraft(
    text,
    generation,
    requestId,
    relativePath,
    lease,
    view = this.view,
    base,
  ) {
    this.savingLease++;
    // A placeholder moved onto the note that appeared on disk; undone below
    // unless that save lands, so a retry can never replace the file's text.
    let adopted = null;
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
      assertWritableResource(noteUri);
      const unchanged = documentSnapshot(this.document);
      const current = () =>
        !this.scope.disposed &&
        this.view === view &&
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
      const activePath = this.editingPath();
      if (
        !Number.isSafeInteger(requestId) ||
        requestId <= 0 ||
        !activePath ||
        relativePath !== activePath
      ) {
        await reply(false);
        return { action: "wrong-note", skipped: true };
      }
      // The note changed under an unsaved draft: the webview sends the text
      // the draft was typed on. The draft's pages are carried onto the note
      // when the same pages did not change there; otherwise nothing is
      // written and the next Ctrl+S tries again.
      let theirs = null;
      if (typeof base === "string" && this.documentUri) {
        try {
          if (!this.document || this.document.isClosed)
            this.document = await vscode.workspace.openTextDocument(
              this.documentUri,
            );
          theirs = this.document.getText();
        } catch {
          return await stale();
        }
      }
      const merge =
        theirs === null ? null : mergeDraftPages(base, theirs, draft);
      if (typeof merge?.text === "string") {
        draft = merge.text;
        generation = this.generation;
      } else if (merge || generation !== this.generation) {
        await reply(false);
        await this.sendPaneState(
          !merge
            ? "File changed externally · draft kept in the editor"
            : merge.conflict === "page"
              ? `This page changed in the file too · draft kept in the editor. ${CONFLICT_EXIT}`
              : `Pages were added, removed, renamed or repeated and the file changed too · draft kept in the editor. ${CONFLICT_EXIT}`,
          Boolean(merge),
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

      if (!current()) return await stale();

      if (
        !this.documentUri &&
        this.placeholderUri &&
        (await exists(this.placeholderUri))
      ) {
        // The note appeared on disk under a typed-in placeholder. The draft's
        // new pages are appended to it; a page the file already has, or text
        // outside a page, stays a draft and nothing on disk is replaced.
        const uri = this.placeholderUri;
        let appeared;
        try {
          appeared = await vscode.workspace.openTextDocument(uri);
        } catch {
          appeared = undefined;
        }
        // A failed attempt may have left its text in the unsaved document.
        const earlier = this.appearedRebase;
        const rebased =
          !appeared || this.placeholderText !== ""
            ? null
            : earlier?.draft === draft && earlier.text === appeared.getText()
              ? earlier.text
              : appendDraftPages(appeared.getText(), draft);
        if (!current()) return await stale();
        if (rebased === null) {
          await reply(false);
          await this.sendPaneState(
            "Note appeared on disk with this page · draft kept in the editor. Copy your text or remove the page from the file, then press Ctrl+S.",
          );
          return { action: "appeared", skipped: true };
        }
        this.documentUri = uri;
        this.document = appeared;
        this.placeholderUri = undefined;
        this.placeholderText = undefined;
        adopted = uri;
        this.appearedRebase = { draft, text: rebased };
        draft = rebased;
      }

      let document;
      if (!this.documentUri && this.placeholderUri) {
        const uri = this.placeholderUri;
        if (await exists(uri)) {
          // It appeared between the check above and this one.
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
      } else {
        if (this.documentUri && !(await exists(this.documentUri))) {
          if (!current()) return await stale();
          await reply(false);
          await this.sendPaneState(
            "Note was deleted or is unavailable · draft kept in the editor. Restore the note before saving.",
          );
          return { action: "missing", skipped: true };
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
      const diskAvailable = await exists(document.uri);
      if (
        this.scope.disposed ||
        this.view !== view ||
        this.generation !== generation ||
        document.getText() !== draft ||
        (this.editSurface && !this.ownership.accepts(this.editSurface, lease))
      )
        return await stale();
      if (!diskAvailable) {
        await reply(false);
        await this.sendPaneState(
          "Note was deleted or is unavailable · draft kept in the editor. Restore the note before saving.",
        );
        return { action: "missing", skipped: true };
      }
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
      adopted = null;
      this.appearedRebase = undefined;
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
      if (adopted && this.documentUri?.toString() === adopted.toString()) {
        this.documentUri = undefined;
        this.document = undefined;
        this.placeholderUri = adopted;
        this.placeholderText = "";
      }
      this.savingLease--;
      if (this.editSurface) void this.ownership.changed(this.editSurface);
    }
  }

  // The way out of a refused merge: drop the pane draft and show the note
  // document again. The file is not written.
  async discardDraft(relativePath, view = this.view) {
    const current = () =>
      !this.scope.disposed &&
      this.view === view &&
      Boolean(this.documentUri) &&
      relativePath === this.editingPath() &&
      this.savingLease === 0;
    if (!current()) return false;
    const confirm = "Discard and reload";
    const choice = await vscode.window.showWarningMessage(
      `Discard your unsaved changes in ${path.posix.basename(this.documentUri.path)} and reload the note as it is in the file? Copy your text first if you need it. The file is not changed.`,
      { modal: true },
      confirm,
    );
    if (choice !== confirm || !current()) return false;
    const document = await this.currentDocument();
    if (!document || !current()) {
      await this.sendPaneState(
        "Note is unavailable · draft kept in the editor",
      );
      return false;
    }
    this.draftRevision++;
    this.draftDirty = false;
    await view?.webview.postMessage({
      type: "reset",
      text: document.getText(),
      generation: this.generation,
    });
    await this.sendPaneState();
    return true;
  }

  async onMessage(message) {
    if (this.scope.disposed) return;
    // Capture before queueing: a replacement view may reuse path, generation
    // and request IDs but must never inherit an old view's pending command.
    const view = this.view;
    try {
      switch (message.type) {
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
                message.base,
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
        case "page.openTarget":
          await openPageTarget(this.folder, message.target);
          break;
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
        case "draft.discard":
          await this.discardDraft(message.relativePath, view);
          break;
        case "draft.saveResult": {
          const resolve = this.saveWaiters.get(message.requestId);
          if (!resolve) break;
          this.saveWaiters.delete(message.requestId);
          const saved =
            message.relativePath === this.editingPath() &&
            message.saved === true;
          resolve?.(saved);
          break;
        }
        case "draft.state": {
          if (
            !this.editingPath() ||
            message.relativePath !== this.editingPath()
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
    if (topic === "file.open" && this.folder && payload?.path) {
      const uri = workspaceLinkUri(this.folder, payload.path);
      if (!uri) return;
      await openSourceAtHref(uri, payload?.href ?? "");
    }
  }
}
