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

// "Open target" of a page card. The target is note content, so only two
// things are opened: an http(s) URL in the browser, and an existing regular
// file (a full path, or a full URI of a file system VS Code can read) in an
// editor tab, as File > Open would. Relative paths, folders and other schemes
// are refused; nothing is ever run.
export function pageTargetUri(target, api = vscode) {
  const value = String(target ?? "").trim();
  if (!value || /[\u0000-\u001f]/u.test(value)) return null;
  const slashed = value.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[a-zA-Z]:\//u.test(slashed))
    return api.Uri.file(slashed);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(value)) return null;
  let uri;
  try {
    uri = api.Uri.parse(value, true);
  } catch {
    return null;
  }
  return uri.scheme !== "untitled" &&
    api.workspace.fs.isWritableFileSystem?.(uri.scheme) !== undefined
    ? uri
    : null;
}

export async function openPageTarget(target) {
  const value = String(target ?? "").trim();
  if (/^https?:\/\//iu.test(value)) return openExternalLink(value);
  const uri = pageTargetUri(value);
  if (!uri)
    throw structuredError(
      "notes_target_unsupported",
      `${value || "this page"} is not a full file path or an http(s) URL`,
      ["Bind the page to a full path, e.g. `--- /home/me/src/app.js`"],
    );
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    stat = undefined;
  }
  if (!stat)
    throw structuredError("notes_target_missing", `${value} does not exist`, [
      "Restore the file or correct the page's `--- <path>` line",
    ]);
  if (!(stat.type & vscode.FileType.File))
    throw structuredError("notes_target_not_file", `${value} is not a file`, [
      "Bind the page to a file, not a folder",
    ]);
  await vscode.commands.executeCommand("vscode.open", uri);
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
