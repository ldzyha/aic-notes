// MermaidPreviewManager — the extension-host half of the live mermaid
// preview (aic's md.preview console slot, reshaped as a WebviewPanel).
// Singleton: ONE panel reused across all editors and fences, last-writer-wins
// adoption. Caret leaving the fences EMPTIES the panel, never disposes it
// (closing an editor-area tab on every caret exit would churn layout).
//
// Dismissal latch — deliberate divergence from aic (whose console slot
// reopens on the next cursor move): a manual ✕ sets `dismissed`; update() is
// a no-op while dismissed; the caret LEAVING all fences resets the latch. So
// the panel reopens on the next fence enter, not while the user is still in
// the fence they closed it from.
//
// Float ("PiP"): the panel tab moves to an auxiliary OS window via
// workbench.action.moveEditorToNewWindow (webview support since VS Code
// ~1.87; engines pins ^1.90). The webview may reload when re-parented — the
// `ready` handshake re-delivers the last payload.

import * as vscode from "vscode";
import { webviewHtml } from "../editor/webview-html.js";

export class MermaidPreviewManager {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.lastPayload = null;
    this.dismissed = false;
  }

  // caret entered/adopted a fence, or a debounced same-fence edit landed
  update({ source, origin }) {
    if (this.dismissed) return;
    this.lastPayload = { type: "render", source, origin };
    this._ensurePanel();
    this.panel.webview.postMessage(this.lastPayload);
  }

  // caret left all fences — empty the panel and re-arm after a manual close
  close() {
    this.dismissed = false;
    this.lastPayload = { type: "empty" };
    this.panel?.webview.postMessage(this.lastPayload);
  }

  // the mirrored editor went away — don't keep rendering a ghost
  handleEditorClosed(relativePath) {
    if (!this.panel || this.lastPayload?.origin !== relativePath) return;
    this.lastPayload = { type: "empty" };
    this.panel.webview.postMessage(this.lastPayload);
  }

  _ensurePanel() {
    if (this.panel) {
      if (!this.panel.visible) this.panel.reveal(undefined, true); // never steal focus
      return;
    }
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    this.panel = vscode.window.createWebviewPanel(
      "aicNotes.mermaidPreview",
      "Mermaid Preview",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [distRoot] },
    );
    this.panel.webview.html = webviewHtml(this.panel.webview, distRoot, "preview.js", "");
    this.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "ready") {
        // fresh script (first load OR a reload after floating): restore state
        if (this.lastPayload) this.panel?.webview.postMessage(this.lastPayload);
      } else if (msg.type === "float") {
        this._float();
      }
    });
    this.panel.onDidDispose(() => {
      this.panel = null;
      this.dismissed = true;
    });
  }

  async _float() {
    if (!this.panel) return;
    // the command acts on the ACTIVE editor — reveal with focus first
    this.panel.reveal(undefined, false);
    await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
  }

  dispose() {
    this.panel?.dispose();
  }
}
