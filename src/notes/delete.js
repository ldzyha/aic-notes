import * as vscode from "vscode";

export async function trashNotesLocally(
  uris,
  { beforeDelete, afterDelete, detail = "" } = {},
) {
  for (const uri of uris) {
    if ((await beforeDelete?.(uri)) === false) return false;
    try {
      await vscode.workspace.fs.delete(uri, { useTrash: true });
    } catch {
      const hard = await vscode.window.showWarningMessage(
        `Trash is unavailable for ${vscode.workspace.asRelativePath(uri, false)}. Delete permanently?`,
        { modal: true, detail: detail || undefined },
        "Delete Permanently",
      );
      if (hard !== "Delete Permanently") return false;
      if ((await beforeDelete?.(uri)) === false) return false;
      await vscode.workspace.fs.delete(uri);
    }
    await afterDelete?.(uri);
  }
  return true;
}
