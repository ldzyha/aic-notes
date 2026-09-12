import * as path from "node:path";
import * as vscode from "vscode";
import { folderNotePathFor } from "./paths.js";

// Folder notes are siblings of their owners: a/b/file.note.md → a/b.note.md,
// while a/b.note.md → a.note.md. The source file need not exist or be unique.
// Yield lazily, nearest first; only the project is allowed to be a placeholder.
export async function* parentNoteCandidates(noteUri) {
  if (noteUri?.scheme !== "file" || !noteUri.path.endsWith(".note.md")) return;
  const folder = vscode.workspace.getWorkspaceFolder(noteUri);
  if (!folder) return;
  const relative = vscode.workspace
    .asRelativePath(noteUri, false)
    .replaceAll("\\", "/");
  if (path.posix.isAbsolute(relative) || relative.split("/").includes(".."))
    return;
  let parent = path.posix.dirname(relative);
  while (parent !== "." && parent !== "/") {
    const targetUri = vscode.Uri.joinPath(folder.uri, parent);
    const candidatePath = folderNotePathFor(parent);
    // Reserve the canonical project identity, even if a same-named folder
    // exists. A directory ending in .note.md has no valid sibling sidecar.
    if (!candidatePath || candidatePath === `${folder.name}.note.md`) {
      parent = path.posix.dirname(parent);
      continue;
    }
    const candidate = vscode.Uri.joinPath(folder.uri, candidatePath);
    let usable = false;
    try {
      usable =
        Boolean(
          (await vscode.workspace.fs.stat(candidate)).type &
          vscode.FileType.File,
        ) &&
        Boolean(
          (await vscode.workspace.fs.stat(targetUri)).type &
          vscode.FileType.Directory,
        );
    } catch {
      /* A missing ancestor is not a placeholder; keep walking upwards. */
    }
    if (usable) yield { targetUri, noteUri: candidate, isProject: false };
    parent = path.posix.dirname(parent);
  }
  yield {
    targetUri: folder.uri,
    noteUri: vscode.Uri.joinPath(folder.uri, `${folder.name}.note.md`),
    isProject: true,
  };
}
