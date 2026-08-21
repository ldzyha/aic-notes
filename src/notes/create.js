// Quick note creation/opening — the ctrl+alt+m path. Mirrors aic's Mod-m
// feel: on a source file it creates/opens the sidecar note beside; on a note
// it jumps back to the target. Fresh notes get the DOCS_CONVENTION
// frontmatter (same keys/order as aic's noteSeed — byte-compatible) plus the
// level's template body (project `.aic/templates/` override honored).

import * as vscode from "vscode";
import * as path from "node:path";
import { notePathFor, folderNotePathFor } from "./paths.js";
import { noteMeta, stringifyFrontmatter } from "./frontmatter.js";
import { loadTemplate, fillTemplate } from "./templates.js";
import { structuredError, formatError } from "../errors.js";
import { GLOBAL_NOTE_PATH } from "./tree.js";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function workspaceReader(folder) {
  return async (relPath) => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, relPath));
    return new TextDecoder().decode(bytes);
  };
}

export async function openNoteDocument(uri, options = {}) {
  if (uri.path.endsWith(".note.md")) {
    await vscode.commands.executeCommand("aicNotes.openInSecondary", uri, options);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", uri);
}

// create <notePath> with header+template if missing, then open it
async function ensureNote(folder, relNotePath, level, titleName, sourceUri) {
  const uri = vscode.Uri.joinPath(folder.uri, relNotePath);
  if (!(await exists(uri))) {
    const template = await loadTemplate(level, workspaceReader(folder));
    const body = fillTemplate(template, titleName);
    const text = stringifyFrontmatter(body, noteMeta(titleName, level));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  }
  await openNoteDocument(uri, { pin: false, sourceUri });
  return uri;
}

export async function noteForCurrentFile() {
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input?.uri;
  if (!uri || uri.scheme !== "file") {
    throw structuredError("notes_no_active_file", "no file-backed editor is active", [
      "Focus a file editor, then run the command again",
    ]);
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${uri.fsPath} is not inside the workspace`, [
      "Open the file's folder as a workspace first",
    ]);
  }
  const relPath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");

  // on a note → toggle back to its target
  if (relPath.endsWith(".note.md")) {
    const { resolveTarget } = await import("./target.js");
    const target = await resolveTarget(folder, relPath);
    if (!target) {
      throw structuredError("notes_orphan", `${relPath} has no existing target`, [
        "The annotated file/folder was moved or deleted — restore it or delete the note",
      ]);
    }
    await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside });
    return;
  }

  const notePath = notePathFor(relPath);
  await ensureNote(folder, notePath, "file-note", path.basename(relPath), uri);
}

export async function noteForExplorerItem(uri) {
  if (!uri) return noteForCurrentFile();
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${uri.fsPath} is not inside the workspace`, [
      "Open the item's folder as a workspace first",
    ]);
  }
  const stat = await vscode.workspace.fs.stat(uri);
  const relPath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  const isDir = Boolean(stat.type & vscode.FileType.Directory);
  const notePath = isDir ? folderNotePathFor(relPath) : notePathFor(relPath);
  if (!notePath) {
    // the item IS a note — just open it
    await openNoteDocument(uri, { pin: true });
    return;
  }
  await ensureNote(
    folder,
    notePath,
    isDir ? "folder-note" : "file-note",
    isDir ? `${path.basename(relPath)}` : path.basename(relPath),
    uri,
  );
}

export async function openProjectNote() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw structuredError("notes_no_workspace", "no workspace folder is open", [
      "Open a folder first",
    ]);
  }
  await ensureNote(folder, `${folder.name}.note.md`, "project-note", folder.name);
}

export async function openGlobalNote() {
  const uri = vscode.Uri.file(GLOBAL_NOTE_PATH);
  if (!(await exists(uri))) {
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(GLOBAL_NOTE_PATH)));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(""));
  }
  await openNoteDocument(uri);
}

// shared command wrapper: structured errors surface as messages, never throw
// into the console silently
export function commandHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      vscode.window.showErrorMessage(`AIC Notes — ${formatError(e)}`);
    }
  };
}
