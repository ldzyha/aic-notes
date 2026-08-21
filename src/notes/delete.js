import * as vscode from "vscode";

export async function deleteNotes(uris, label, tree, detail = "", beforeDelete) {
  const paths = uris.map((uri) => vscode.workspace.asRelativePath(uri, false)).join("\n");
  const confirm = await vscode.window.showWarningMessage(
    `Delete ${label}?`,
    { modal: true, detail: [paths, detail].filter(Boolean).join("\n\n") },
    "Move to Trash",
  );
  if (confirm !== "Move to Trash") return false;
  await beforeDelete?.();
  for (const uri of uris) {
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch {
      const hard = await vscode.window.showWarningMessage(
        `Trash is unavailable for ${vscode.workspace.asRelativePath(uri, false)}. Delete permanently?`,
        { modal: true, detail: detail || undefined },
        "Delete Permanently",
      );
      if (hard !== "Delete Permanently") return false;
      await vscode.workspace.fs.delete(uri);
    }
  }
  tree?.refresh();
  return true;
}
