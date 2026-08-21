import * as vscode from "vscode";
import { sourceLocationFromHref } from "./selection-model.js";

export async function openSourceAtHref(uri, href) {
  const editor = await vscode.window.showTextDocument(uri);
  const location = sourceLocationFromHref(href);
  if (!location.line) return editor;

  const startLine = Math.min(location.line - 1, editor.document.lineCount - 1);
  const endLine = Math.min(location.endLine - 1, editor.document.lineCount - 1);
  const range = new vscode.Range(
    new vscode.Position(startLine, 0),
    editor.document.lineAt(endLine).range.end,
  );
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return editor;
}
