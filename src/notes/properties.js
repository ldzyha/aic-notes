import * as vscode from "vscode";
import * as path from "node:path";
import { stampFileProperties } from "../../vendor/aic-editor-core/file-properties.js";

/** Both note surfaces stamp only when explicitly saving, never while routing. */
export async function stampNoteProperties(markdown, uri) {
  const updatedAt = new Date().toISOString();
  let createdAt = updatedAt;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (Number.isFinite(stat.ctime) && stat.ctime > 0)
      createdAt = new Date(stat.ctime).toISOString();
  } catch {
    // A new placeholder has no file stat yet.
  }
  return stampFileProperties(markdown, {
    fileName: path.basename(uri.fsPath),
    createdAt,
    updatedAt,
  });
}
