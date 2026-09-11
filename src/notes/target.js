// Reverse note→target resolution. A note's stem (path minus ".note.md") is
// either a literal path (folder note, dotfile/extension-less file note) or a
// file note whose final extension was stripped — in that case the target is
// the sibling `<stem>.*` that is not itself a note.

import * as vscode from "vscode";
import { noteTargetStem } from "./paths.js";
import { structuredError } from "../errors.js";

async function siblingMatch(folder, t, requireUnambiguous = false) {
  const dirUri = vscode.Uri.joinPath(folder.uri, t.dir);
  const base = t.stem.slice(t.stem.lastIndexOf("/") + 1);
  try {
    const entries = await vscode.workspace.fs.readDirectory(dirUri);
    const matches = entries.filter(
      ([name, type]) =>
        type & vscode.FileType.File &&
        !name.endsWith(".note.md") &&
        name.replace(/(?<=[^.])\.[^.]+$/, "") === base,
    );
    if (requireUnambiguous && matches.length > 1) {
      throw structuredError(
        "notes_source_ambiguous",
        `${t.stem}.note.md matches multiple sources: ${matches
          .map(([name]) => name)
          .sort()
          .join(", ")}`,
        [
          "Open the intended source file directly; a shared sidecar cannot identify one source automatically",
        ],
      );
    }
    if (matches[0]) return vscode.Uri.joinPath(dirUri, matches[0][0]);
  } catch (error) {
    if (error?.structured?.error === "notes_source_ambiguous") throw error;
    /* dir gone */
  }
  return null;
}

// → target Uri, or null when the note is an orphan
export async function resolveTarget(
  folder,
  relNotePath,
  { requireUnambiguous = false } = {},
) {
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
  return siblingMatch(folder, t, requireUnambiguous);
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
