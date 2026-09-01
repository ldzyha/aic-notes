import * as vscode from "vscode";

export async function trashNotesLocally(
  uris,
  { beforeDelete, afterDelete, detail = "" } = {},
) {
  if ((await beforeDelete?.()) === false) return false;
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
    await afterDelete?.(uri);
  }
  return true;
}

export async function deleteNotes(
  uris,
  label,
  tree,
  detail = "",
  beforeDelete,
  afterDelete,
) {
  const paths = uris
    .map((uri) => vscode.workspace.asRelativePath(uri, false))
    .join("\n");
  const confirm = await vscode.window.showWarningMessage(
    `Delete ${label}?`,
    { modal: true, detail: [paths, detail].filter(Boolean).join("\n\n") },
    "Move to Trash",
  );
  if (confirm !== "Move to Trash") return false;
  const deleted = await trashNotesLocally(uris, {
    beforeDelete,
    afterDelete,
    detail,
  });
  if (deleted) tree?.refresh();
  return deleted;
}
