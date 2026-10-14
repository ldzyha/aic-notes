import * as vscode from "vscode";
import { structuredError, formatError } from "../errors.js";
import { activeWindowResource } from "../secondary/model.js";
import { resourceLabel, workspaceFolderFor } from "./resources.js";

export async function openNoteDocument(uri, options = {}) {
  if (uri.path.endsWith(".note.md")) {
    await vscode.commands.executeCommand(
      "vscode.openWith",
      uri,
      "aicNotes.markdown",
      {
        preview: false,
        preserveFocus: Boolean(options.preserveFocus),
      },
    );
    return;
  }
  await vscode.commands.executeCommand("vscode.open", uri);
}

// Reveal the Secondary pane on the active file's page of the workspace note
// `aic.md`. Nothing is created: the page is written by the first saved edit.
export async function noteForCurrentFile(secondary) {
  if (!vscode.workspace.workspaceFolders?.length) {
    throw structuredError("notes_no_workspace", "no workspace folder is open", [
      "Open a folder first",
    ]);
  }
  const uri = activeWindowResource(vscode.window);
  if (uri?.scheme === "file" && !workspaceFolderFor(uri)) {
    throw structuredError(
      "notes_outside_workspace",
      `${resourceLabel(uri)} is not inside the workspace`,
      ["Open the file's folder as a workspace first"],
    );
  }
  await secondary.followActive();
  await secondary.focus(false);
}

// shared command wrapper: structured errors surface as messages, never throw
// into the console silently
export function commandHandler(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      vscode.window.showErrorMessage(`AIC Notes — ${formatError(e)}`);
    }
  };
}
