// Reverse note→target resolution. A note's stem (path minus ".note.md") is
// either a literal path (folder note, dotfile/extension-less file note) or a
// file note whose final extension was stripped — in that case the target is
// the sibling `<stem>.*` that is not itself a note.

import * as vscode from "vscode";
import { noteTargetStem } from "./paths.js";

async function siblingMatch(folder, t) {
  const dirUri = vscode.Uri.joinPath(folder.uri, t.dir);
  const base = t.stem.slice(t.stem.lastIndexOf("/") + 1);
  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    const match = entries.find(
      ([name, type]) =>
        type & vscode.FileType.File &&
        !name.endsWith(".note.md") &&
        name.replace(/(?<=[^.])\.[^.]+$/, "") === base,
    );
    if (match) return vscode.Uri.joinPath(dirUri, match[0]);
  } catch {
    /* dir gone */
  }
  return null;
}

// → target Uri, or null when the note is an orphan
export async function resolveTarget(folder, relNotePath) {
  if (relNotePath === `${folder.name}.note.md`) return folder.uri;
  const t = noteTargetStem(relNotePath);
  if (!t) return null;
  const stemUri = vscode.Uri.joinPath(folder.uri, t.stem);
  try {
    await vscode.workspace.fs.stat(stemUri);
    return stemUri;
  } catch {
    /* not literal — try extension-stripped sibling */
  }
  return siblingMatch(folder, t);
}

// → "folder" | "file" | null (orphan)
export async function targetKind(folder, relNotePath) {
  if (relNotePath === `${folder.name}.note.md`) return "folder";
  const t = noteTargetStem(relNotePath);
  if (!t) return null;
  const stemUri = vscode.Uri.joinPath(folder.uri, t.stem);
  try {
    const stat = await vscode.workspace.fs.stat(stemUri);
    return stat.type & vscode.FileType.Directory ? "folder" : "file";
  } catch {
    /* not literal */
  }
  return (await siblingMatch(folder, t)) ? "file" : null;
}
