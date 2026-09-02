// Quick note creation/opening — the ctrl+alt+m path. Mirrors aic's Mod-m
// feel: on a source file it creates/opens the sidecar note beside; on a note
// it jumps back to the target. Fresh notes get only the shared managed
// file/created/updated properties plus the level's template body (project
// `.aic/templates/` override honored).

import * as vscode from "vscode";
import * as path from "node:path";
import { notePathFor, folderNotePathFor } from "./paths.js";
import { loadTemplate, fillTemplate } from "./templates.js";
import { structuredError, formatError } from "../errors.js";
import { activeResource } from "../secondary/model.js";
import { stampFileProperties } from "../../vendor/aic-editor-core/file-properties.js";

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function noteDescriptorForUri(uri) {
  if (!uri || uri.scheme !== "file" || uri.path.endsWith(".note.md")) {
    throw structuredError("notes_no_target", "no file-backed source or folder is available", [
      "Choose a workspace file or folder, then retry",
    ]);
  }
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${uri.fsPath} is not inside the workspace`, [
      "Open the file's folder as a workspace first",
    ]);
  }
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch (error) {
    throw structuredError("notes_source_missing", `${uri.fsPath} no longer exists`, [
      "Restore the source or choose another workspace item",
    ]);
  }
  const isDirectory = Boolean(stat.type & vscode.FileType.Directory);
  const isWorkspaceRoot = uri.toString() === folder.uri.toString();
  const rawRelPath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  const relPath = isWorkspaceRoot || rawRelPath === "." ? "" : rawRelPath;
  const level = isDirectory
    ? isWorkspaceRoot ? "project-note" : "folder-note"
    : "file-note";
  const notePath = level === "project-note"
    ? `${folder.name}.note.md`
    : level === "folder-note"
      ? folderNotePathFor(relPath)
      : notePathFor(relPath);
  if (!notePath) {
    throw structuredError("notes_target_invalid", `${uri.fsPath} cannot have a linked note`, [
      "Choose a workspace file or folder",
    ]);
  }
  const noteUri = vscode.Uri.joinPath(folder.uri, notePath);
  const title = level === "project-note" ? folder.name : path.basename(relPath);
  return { folder, relPath, notePath, noteUri, title, level, isDirectory, isWorkspaceRoot };
}

function workspaceReader(folder) {
  return async (relPath) => {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, relPath));
    return new TextDecoder().decode(bytes);
  };
}

function freshNoteText(body, noteUri) {
  const timestamp = new Date().toISOString();
  return stampFileProperties(body, {
    fileName: path.basename(noteUri.fsPath),
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function openNoteDocument(uri, options = {}) {
  if (uri.path.endsWith(".note.md")) {
    await vscode.commands.executeCommand("aicNotes.openInSecondary", uri, options);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", uri);
}

// Create <notePath> with header+template if missing. Keeping creation separate
// from navigation lets the Secondary placeholder and selection-link action use
// the same deterministic seed without opening an intermediate editor.
export async function ensureNoteFile(folder, relNotePath, level, titleName) {
  const uri = vscode.Uri.joinPath(folder.uri, relNotePath);
  if (!(await exists(uri))) {
    const template = await loadTemplate(level, workspaceReader(folder));
    const body = fillTemplate(template, titleName);
    const text = freshNoteText(body, uri);
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  }
  return uri;
}

// Produce the exact fresh file-note bytes without writing them. Secondary uses
// this for its editable placeholder so merely viewing a source never creates a
// sidecar; the first explicit save persists these same bytes plus the draft.
export async function fileNotePlaceholderForUri(uri) {
  const descriptor = await noteDescriptorForUri(uri);
  if (descriptor.level !== "file-note") {
    throw structuredError("notes_source_not_file", `${uri.fsPath} is not a file`, [
      "Choose a source file",
    ]);
  }
  const template = await loadTemplate(descriptor.level, workspaceReader(descriptor.folder));
  const body = fillTemplate(template, descriptor.title);
  return {
    ...descriptor,
    text: freshNoteText(body, descriptor.noteUri),
  };
}

// File, folder, and workspace-root notes share one lazy-creation contract.
// Merely opening a target returns canonical bytes; only the first explicit
// save writes the sidecar to disk.
export async function notePlaceholderForUri(uri) {
  const descriptor = await noteDescriptorForUri(uri);
  const template = await loadTemplate(descriptor.level, workspaceReader(descriptor.folder));
  const body = fillTemplate(template, descriptor.title);
  return {
    ...descriptor,
    text: freshNoteText(body, descriptor.noteUri),
  };
}

export async function noteForCurrentFile(secondary) {
  const editor = vscode.window.activeTextEditor;
  const tabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = activeResource(
    tabInput?.uri ?? tabInput?.modified,
    editor?.document.uri,
  );
  if (!uri || uri.scheme !== "file") {
    throw structuredError("notes_no_active_file", "no file-backed editor is active", [
      "Focus a file editor, then run the command again",
    ]);
  }
  if (!uri.path.endsWith(".note.md")) {
    await secondary.followSource(uri, { force: true, preserveFocus: false });
    return;
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${uri.fsPath} is not inside the workspace`, [
      "Open the file's folder as a workspace first",
    ]);
  }
  const relPath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  const { resolveTarget } = await import("./target.js");
  const target = await resolveTarget(folder, relPath);
  if (!target) {
    throw structuredError("notes_orphan", `${relPath} has no existing target`, [
      "The annotated file/folder was moved or deleted — restore it or delete the note",
    ]);
  }
  await vscode.window.showTextDocument(target, { viewColumn: vscode.ViewColumn.Beside });
}

export async function noteForExplorerItem(uri, secondary) {
  if (!uri) return noteForCurrentFile(secondary);
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${uri.fsPath} is not inside the workspace`, [
      "Open the item's folder as a workspace first",
    ]);
  }
  const stat = await vscode.workspace.fs.stat(uri);
  const isDir = Boolean(stat.type & vscode.FileType.Directory);
  if (!isDir && !uri.path.endsWith(".note.md")) {
    await secondary.followSource(uri, { force: true, preserveFocus: false });
    return;
  }
  if (!isDir) {
    // the item IS a note — just open it
    await openNoteDocument(uri, { reveal: true });
    return;
  }
  await secondary.followTarget(uri, { force: true, preserveFocus: false });
}

export async function openProjectNote(secondary, targetUri) {
  const folder = targetUri
    ? vscode.workspace.getWorkspaceFolder(targetUri)
    : vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw structuredError("notes_no_workspace", "no workspace folder is open", [
      "Open a folder first",
    ]);
  }
  await secondary.followTarget(folder.uri, { force: true, preserveFocus: false });
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
