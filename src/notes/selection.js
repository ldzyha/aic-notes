import * as vscode from "vscode";
import * as path from "node:path";
import { ensureNoteFile } from "./create.js";
import { structuredError } from "../errors.js";
import {
  linkedCodeReference,
  noteTargetForSource,
  selectedLineRange,
  upsertLinkedCodeReference,
} from "./selection-model.js";

async function verifiedTarget(folder, sourcePath) {
  const target = noteTargetForSource(sourcePath);
  if (!target) return null;
  if (!target.ai) {
    return { notePath: target.notePath, level: "file-note", title: path.basename(sourcePath) };
  }

  const projectNotePath = `${folder.name}.note.md`;
  const projectAiPath = `${folder.name}.ai.md`;
  if (sourcePath === projectAiPath) {
    return {
      notePath: projectNotePath,
      level: "project-note",
      title: folder.name,
    };
  }

  const ownerUri = vscode.Uri.joinPath(folder.uri, target.ownerPath);
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(ownerUri);
  } catch {
    return null;
  }
  const directory = Boolean(stat.type & vscode.FileType.Directory);
  return {
    notePath: target.notePath,
    level: directory ? "folder-note" : "file-note",
    title: path.posix.basename(target.ownerPath),
  };
}

export async function linkSelectionToNote(secondary) {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  if (!editor || !document || document.uri.scheme !== "file") {
    throw structuredError("selection_required", "select source lines in a saved workspace file", [
      "Focus a file-backed text editor, select one or more lines, then retry",
    ]);
  }
  if (document.isDirty) {
    if (!(await document.save())) {
      throw structuredError("selection_source_unsaved", "the selected source could not be saved", [
        "Resolve the file-system error so the linked range can identify persisted bytes",
      ]);
    }
  }
  if (editor.selection.isEmpty) {
    throw structuredError("selection_required", "the source selection is empty", [
      "Select one or more source characters, then retry",
    ]);
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    throw structuredError("notes_outside_workspace", `${document.uri.fsPath} is outside the workspace`, [
      "Open the source folder as a workspace first",
    ]);
  }
  const sourcePath = vscode.workspace.asRelativePath(document.uri, false).replaceAll("\\", "/");
  const target = await verifiedTarget(folder, sourcePath);
  if (!target) {
    throw structuredError("selection_note_owner_unresolved", `${sourcePath} has no verified note owner`, [
      "Restore the source owner or resolve the same-stem ambiguity, then retry",
    ]);
  }

  const source = document.getText();
  const range = selectedLineRange(
    source,
    document.offsetAt(editor.selection.anchor),
    document.offsetAt(editor.selection.active),
  );
  if (!range) {
    throw structuredError("selection_required", "the source selection is empty", [
      "Select one or more source characters, then retry",
    ]);
  }
  const reference = linkedCodeReference(sourcePath, range.line, range.endLine);
  const selectedText = document.getText(editor.selection);
  const noteUri = await ensureNoteFile(folder, target.notePath, target.level, target.title);
  const note = await vscode.workspace.openTextDocument(noteUri);
  const noteText = note.getText();
  const result = upsertLinkedCodeReference(noteText, reference, selectedText);
  if (result.text !== noteText) {
    const edit = new vscode.WorkspaceEdit();
    edit.replace(noteUri, new vscode.Range(note.positionAt(0), note.positionAt(noteText.length)), result.text);
    if (!(await vscode.workspace.applyEdit(edit))) {
      throw structuredError("selection_note_write_failed", `could not update ${target.notePath}`, [
        "Retry after resolving any note conflict",
      ]);
    }
  }
  await secondary.open(noteUri, {
    pin: false,
    reveal: true,
    sourceUri: document.uri,
    selection: { anchor: result.cursor, head: result.cursor },
  });
  if (note.isDirty && !(await note.save())) {
    throw structuredError("selection_note_save_failed", `could not save ${target.notePath}`, [
      "Resolve the file-system error and retry",
    ]);
  }
  vscode.window.setStatusBarMessage(
    result.created
      ? `AIC Notes: linked ${reference.label}`
      : `AIC Notes: opened existing link to ${reference.label}`,
    4000,
  );
}
