import * as vscode from "vscode";

/** Capture before async preparation; validate again at the mutation boundary.
 * WorkspaceEdit supplies VS Code's document-version check. This guard also
 * detects same-text revisions and host/session changes before submitting it. */
export function documentSnapshot(document) {
  const text = document?.getText();
  const version = document?.version;
  return () =>
    !document ||
    (!document.isClosed &&
      document.version === version &&
      document.getText() === text);
}

export async function createNoteDocument(uri, text, isCurrent) {
  if (!isCurrent()) return undefined;
  const edit = new vscode.WorkspaceEdit();
  // A create edit refuses an intervening file; a stat/writeFile pair cannot.
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
  edit.insert(uri, new vscode.Position(0, 0), text);
  if (!(await vscode.workspace.applyEdit(edit))) return undefined;
  return vscode.workspace.openTextDocument(uri);
}
