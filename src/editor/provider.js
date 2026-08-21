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

// [[target]] → note path candidates, aic LINK_RE semantics (sync.js:913):
// a *.md target is used as-is, anything else gets `.note.md`; tried both
// project-root-relative and relative to the linking note's folder
async function resolveWikiTarget(folder, fromRelPath, target) {
  const t = target.split("|")[0].split("#")[0].trim().replace(/^\.?\//, "");
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
  static register(context) {
    return vscode.window.registerCustomEditorProvider(
      "aicNotes.markdown",
      new MarkdownEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    );
  }

  constructor(context) {
    this.context = context;
  }

  async resolveCustomTextEditor(document, webviewPanel) {
    const webview = webviewPanel.webview;
    const distRoot = vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview");
    webview.options = { enableScripts: true, localResourceRoots: [distRoot] };
    webview.html = this._html(webview, distRoot);

    const state = { generation: 0, applying: 0 };
    const relativePath = vscode.workspace.asRelativePath(document.uri, false).replaceAll("\\", "/");
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);

    const sendInit = () =>
      webview.postMessage({
        type: "init",
        text: document.getText(),
        generation: state.generation,
        relativePath,
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

    const messageSub = webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case "ready":
            sendInit();
            break;
          case "edit": {
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
                new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)),
                c.insert,
              );
            }
            state.applying++;
            const ok = await vscode.workspace.applyEdit(edit);
            state.applying--;
            if (!ok) sendReset();
            break;
          }
          case "undo":
          case "redo":
            // the resulting change is a NON-echo document event → broadcast
            // back to the webview as `external` (it did not apply it locally)
            await vscode.commands.executeCommand(msg.type);
            break;
          case "save":
            await document.save();
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

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      messageSub.dispose();
    });
  }

  async _routeBus(msg, document, folder, relativePath) {
    const { topic, payload } = msg;
    if (topic === "link.external") {
      const url = String(payload?.url ?? "");
      if (!/^(?:https?:|mailto:|tel:|vscode:)/i.test(url)) {
        vscode.window.showWarningMessage(`AIC Notes — refusing to open non-http(s) link: ${url}`);
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
        await vscode.commands.executeCommand("aicNotes.openInSecondary", uri, {
          pin: true,
          reveal: true,
        });
      } else {
        await vscode.commands.executeCommand("vscode.open", uri);
      }
      return;
    }
    if (topic === "wiki.open") {
      if (!folder) return;
      const uri = await resolveWikiTarget(folder, relativePath, String(payload?.target ?? ""));
      if (!uri) {
        vscode.window.showErrorMessage(
          `AIC Notes — wiki_link_unresolved: [[${payload?.target}]] matches no note — fix: create the note or correct the link`,
        );
        return;
      }
      await vscode.commands.executeCommand("aicNotes.openInSecondary", uri, {
        pin: true,
        reveal: true,
      });
    }
  }

  _html(webview, distRoot) {
    return webviewHtml(webview, distRoot, "main.js", '<div id="editor"></div>');
  }
}
