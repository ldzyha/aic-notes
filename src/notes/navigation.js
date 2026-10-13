import * as vscode from "vscode";
import * as path from "./uri-path.js";
import { sourceLocationFromHref } from "./selection-model.js";
import { structuredError } from "../errors.js";

// Webview links are document content, not trusted filesystem capabilities.
// Allow relative wiki traversal only when its normalized destination remains
// inside the originating workspace folder.
export function workspaceLinkUri(folder, value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\\") ||
    /[\u0000-\u001f]/u.test(value) ||
    path.posix.isAbsolute(value) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(value)
  )
    return null;
  const relative = path.posix.normalize(value);
  if (relative === "." || relative === ".." || relative.startsWith("../"))
    return null;
  const uri = vscode.Uri.joinPath(folder.uri, relative);
  if (
    uri.scheme !== folder.uri.scheme ||
    uri.authority !== folder.uri.authority
  )
    return null;
  const folderPath = folder.uri.path.replace(/\/$/u, "");
  const actual = uri.path;
  if (actual !== `${folderPath}/${relative}`) return null;
  return uri;
}

export async function openExternalLink(value) {
  const url = String(value ?? "");
  if (!/^(?:https?:|mailto:|tel:)/iu.test(url)) {
    vscode.window.showWarningMessage(
      "AIC Notes — external links support HTTP, HTTPS, mailto and tel only",
    );
    return false;
  }
  return vscode.env.openExternal(vscode.Uri.parse(url));
}

// "Open target" of a page card. The target is note content: a path is taken
// relative to the note's workspace folder and must stay inside it; only
// http(s) URLs leave the editor.
export async function openPageTarget(folder, target) {
  const value = String(target ?? "").trim();
  if (/^https?:\/\//iu.test(value)) return openExternalLink(value);
  const relative = value
    .replaceAll("\\", "/")
    .replace(/^(?:\.?\/)+/u, "")
    .replace(/\/+$/u, "");
  const uri = folder ? workspaceLinkUri(folder, relative) : null;
  if (!uri)
    throw structuredError(
      "notes_target_outside_workspace",
      `${value || "this page"} is not a path inside the note's workspace folder`,
      ["Bind the page to a path relative to the workspace folder"],
    );
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    throw structuredError(
      "notes_target_missing",
      `${relative} does not exist`,
      ["Restore the file or correct the page's `--- <path>` line"],
    );
  }
  if (stat.type & vscode.FileType.Directory)
    await vscode.commands.executeCommand("revealInExplorer", uri);
  else await vscode.commands.executeCommand("vscode.open", uri);
  return true;
}

export async function openSourceAtHref(uri, href) {
  const editor = await vscode.window.showTextDocument(uri);
  const location = sourceLocationFromHref(href);
  if (!location.line) return editor;

  const startLine = Math.min(location.line - 1, editor.document.lineCount - 1);
  const endLine = Math.min(location.endLine - 1, editor.document.lineCount - 1);
  const range = new vscode.Range(
    new vscode.Position(startLine, 0),
    editor.document.lineAt(endLine).range.end,
  );
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(
    range,
    vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  );
  return editor;
}
