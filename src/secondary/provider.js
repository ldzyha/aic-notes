import * as vscode from "vscode";
import { webviewHtml } from "../editor/webview-html.js";
import { formatError, structuredError } from "../errors.js";
import { linkedNotePath, isNotePath } from "./model.js";
import { resolveTarget } from "../notes/target.js";
import { ensureFileNoteForUri } from "../notes/create.js";
import { openSourceAtHref } from "../notes/navigation.js";

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
    );
    queueMicrotask(() => pane.routeNoteTabs());
    return pane;
  }

  constructor(context, syncService) {
    this.context = context;
    this.syncService = syncService;
    this.view = undefined;
    this.document = undefined;
    this.sourceUri = undefined;
    this.pinned = false;
    this.ready = false;
    this.generation = 0;
    this.applying = 0;
    this.editQueue = Promise.resolve();
    this.pendingViewState = undefined;
    this.creating = false;
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
        <div class="aic-pane-heading">
          <strong id="pane-title">Linked note</strong>
          <button id="pane-pin" type="button" title="Pin or follow active file">Follow</button>
        </div>
        <div class="aic-pane-actions">
          <button id="pane-mode" type="button">Edit</button>
          <button id="pane-target" type="button">Source</button>
          <button id="pane-sync" type="button">Sync</button>
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
    if (this.document) await this.sendInit();
    else await this.sendPaneState();
  }

  async focus(preserveFocus = false) {
    try {
      await vscode.commands.executeCommand(`${SECONDARY_VIEW_ID}.focus`, { preserveFocus });
    } catch {
      await vscode.commands.executeCommand("workbench.action.focusSecondarySideBar");
    }
  }

  async open(uri, { pin = true, reveal = true, sourceUri, mode = "preview", selection } = {}) {
    if (!uri || uri.scheme !== "file" || !isNotePath(uri.path)) {
      throw structuredError("notes_not_sidecar", `${uri?.fsPath ?? "resource"} is not a *.note.md sidecar`, [
        "Choose a sidecar note",
      ]);
    }
    this.pinned = pin;
    this.sourceUri = sourceUri;
    this.pendingViewState = { mode, selection };
    await this.attach(uri);
    if (reveal) await this.focus(false);
    await this.closeExactNoteTabs(uri);
  }

  async attach(uri) {
    if (this.document?.uri.toString() === uri.toString()) {
      await this.sendInit();
      return;
    }
    this.document = await vscode.workspace.openTextDocument(uri);
    this.generation++;
    await this.sendInit();
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
      this.pendingViewState = undefined;
      this.generation++;
      await this.sendPaneState();
      return false;
    }
    this.pendingViewState = { mode: "preview" };
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
    if (!this.document || event.document.uri.toString() !== this.document.uri.toString()) return;
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
    if (!this.document || !this.view || !this.ready) {
      await this.sendPaneState();
      return;
    }
    const relativePath = vscode.workspace.asRelativePath(this.document.uri, false).replaceAll("\\", "/");
    const viewState = this.pendingViewState;
    await this.view.webview.postMessage({
      type: "init",
      text: this.document.getText(),
      generation: this.generation,
      relativePath,
      surface: "secondary",
      mode: viewState?.mode ?? "preview",
      selection: viewState?.selection,
    });
    this.pendingViewState = undefined;
    await this.sendPaneState();
  }

  async sendPaneState(status = "") {
    if (!this.view) return;
    const relativePath = this.document
      ? vscode.workspace.asRelativePath(this.document.uri, false).replaceAll("\\", "/")
      : "";
    let candidatePath = "";
    if (!this.document && this.sourceUri) {
      const folder = vscode.workspace.getWorkspaceFolder(this.sourceUri);
      if (folder) {
        const sourcePath = vscode.workspace.asRelativePath(this.sourceUri, false).replaceAll("\\", "/");
        candidatePath = linkedNotePath(sourcePath) ?? "";
      }
    }
    await this.view.webview.postMessage({
      type: "paneState",
      title: relativePath || candidatePath || "Linked note",
      pinned: this.pinned,
      autoOpen: this.autoOpen,
      hasNote: Boolean(this.document),
      canCreate: Boolean(candidatePath) && !this.creating,
      candidatePath,
      status,
    });
  }

  async applyChanges(changes, generation) {
    if (!this.document) return;
    if (generation !== this.generation) {
      this.generation++;
      await this.view?.webview.postMessage({
        type: "reset",
        text: this.document.getText(),
        generation: this.generation,
      });
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
      edit.replace(
        this.document.uri,
        new vscode.Range(this.document.positionAt(change.from), this.document.positionAt(change.to)),
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
    if (!this.document || text === this.document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      this.document.uri,
      new vscode.Range(this.document.positionAt(0), this.document.positionAt(this.document.getText().length)),
      text,
    );
    this.applying++;
    try {
      if (!(await vscode.workspace.applyEdit(edit))) throw new Error("workspace rejected synced note");
      await this.document.save();
      this.generation++;
      await this.view?.webview.postMessage({ type: "reset", text, generation: this.generation });
    } finally {
      this.applying--;
    }
  }

  async onMessage(message) {
    try {
      switch (message.type) {
        case "ready":
          this.ready = true;
          if (this.document) await this.sendInit();
          else await this.followActive();
          break;
        case "edit":
          this.editQueue = this.editQueue.catch(() => undefined).then(() =>
            this.applyChanges(message.changes ?? [], message.generation),
          );
          await this.editQueue;
          break;
        case "save":
          await this.document?.save();
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
          if (this.document || !this.sourceUri || this.creating) return;
          const sourceUri = this.sourceUri;
          this.creating = true;
          await this.sendPaneState("Creating…");
          try {
            const noteUri = await ensureFileNoteForUri(sourceUri);
            await this.open(noteUri, {
              pin: false,
              reveal: true,
              sourceUri,
              mode: "edit",
            });
          } finally {
            this.creating = false;
            await this.sendPaneState("");
          }
          break;
        }
        case "pane.target": {
          if (!this.document) return;
          const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
          if (!folder) return;
          const rel = vscode.workspace.asRelativePath(this.document.uri, false).replaceAll("\\", "/");
          const target = await resolveTarget(folder, rel);
          if (target) await vscode.window.showTextDocument(target);
          break;
        }
        case "pane.sync": {
          if (!this.document) return;
          await this.document.save();
          await this.sendPaneState("Synchronizing…");
          const result = await this.syncService.sync(this.document.uri, this.document.getText());
          if (!result) {
            await this.sendPaneState("");
            return;
          }
          if (typeof result.localContent === "string") await this.replaceDocument(result.localContent);
          await this.sendPaneState(`Synced · ${result.action}`);
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
    if (topic === "file.open" && this.document && payload?.path) {
      const folder = vscode.workspace.getWorkspaceFolder(this.document.uri);
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
