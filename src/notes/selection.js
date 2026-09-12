import * as vscode from "vscode";
import * as path from "node:path";
import { folderNotePathFor } from "./paths.js";
import { activeWindowResource } from "../secondary/model.js";
import { documentSnapshot } from "./operation.js";
import { structuredError } from "../errors.js";
import {
  linkedCodeReference,
  noteTargetForSource,
  selectedLineRange,
} from "./selection-model.js";

async function verifiedTarget(folder, sourcePath) {
  const target = noteTargetForSource(sourcePath);
  if (!target) return null;
  if (!target.ai) {
    return {
      notePath: target.notePath,
      level: "file-note",
      title: path.basename(sourcePath),
    };
  }

  const projectNotePath = `${folder.name}.note.md`;
  const projectAiPath = `${folder.name}.ai.md`;
  if (sourcePath === projectAiPath) {
    return {
      notePath: projectNotePath,
      level: "project-note",
      title: folder.name,
      ownerUri: folder.uri,
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
    notePath: directory ? folderNotePathFor(target.ownerPath) : target.notePath,
    ownerUri,
    level: directory ? "folder-note" : "file-note",
    title: path.posix.basename(target.ownerPath),
  };
}

export async function linkSelectionToNote(secondary, markdownEditor) {
  const nativeEditor = vscode.window.activeTextEditor;
  const active = activeWindowResource(vscode.window);
  const editor =
    nativeEditor?.document?.uri?.scheme === "file" &&
    nativeEditor.document.uri.toString() === active?.toString() &&
    !nativeEditor.selection.isEmpty
      ? nativeEditor
      : await markdownEditor?.activeSourceSelection?.();
  const document = editor?.document;
  if (
    !editor ||
    !document ||
    document.uri.scheme !== "file" ||
    document.uri.toString() !== active?.toString()
  ) {
    throw structuredError(
      "selection_required",
      "select source text in a saved workspace file",
      [
        "Select one or more source characters in the native or AIC Markdown editor, then retry",
      ],
    );
  }
  if (document.isDirty) {
    throw structuredError(
      "selection_source_unsaved",
      "save the selected source before linking it",
      [
        "Press Ctrl+S so the linked range identifies persisted source text, then retry",
      ],
    );
  }
  const unchanged = documentSnapshot(document);
  if (editor.selection.isEmpty) {
    throw structuredError(
      "selection_required",
      "the source selection is empty",
      ["Select one or more source characters, then retry"],
    );
  }
  const folder = vscode.workspace.getWorkspaceFolder(document.uri);
  if (!folder) {
    throw structuredError(
      "notes_outside_workspace",
      `${document.uri.fsPath} is outside the workspace`,
      ["Open the source folder as a workspace first"],
    );
  }
  const sourcePath = vscode.workspace
    .asRelativePath(document.uri, false)
    .replaceAll("\\", "/");
  const target = await verifiedTarget(folder, sourcePath);
  if (!target) {
    throw structuredError(
      "selection_note_owner_unresolved",
      `${sourcePath} has no verified note owner`,
      [
        "Restore the source owner or resolve the same-stem ambiguity, then retry",
      ],
    );
  }

  const source = document.getText();
  const range = selectedLineRange(
    source,
    document.offsetAt(editor.selection.anchor),
    document.offsetAt(editor.selection.active),
  );
  if (!range) {
    throw structuredError(
      "selection_required",
      "the source selection is empty",
      ["Select one or more source characters, then retry"],
    );
  }
  const reference = linkedCodeReference(sourcePath, range.line, range.endLine);
  const selectedText = document.getText(editor.selection);
  if (!unchanged()) {
    throw structuredError(
      "selection_source_changed",
      "the source changed while resolving its note",
      ["Select the current source text and retry"],
    );
  }
  const noteUri = vscode.Uri.joinPath(folder.uri, target.notePath);
  const result = await secondary.insertLinkedCode(noteUri, {
    sourceUri: target.ownerUri ?? document.uri,
    reference,
    selectedText,
  });
  if (!result) return false;
  vscode.window.setStatusBarMessage(
    result.created
      ? `AIC Notes: linked ${reference.label}`
      : `AIC Notes: opened existing link to ${reference.label}`,
    4000,
  );
}
