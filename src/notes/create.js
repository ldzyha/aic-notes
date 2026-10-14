import * as vscode from "vscode";
import { formatError } from "../errors.js";

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

// Reveal the Secondary pane on the active file's page of the note file,
// asking for the note file first when none is chosen. Nothing is created: the
// page is written by the first saved edit.
export async function noteForCurrentFile(secondary) {
  if (!(await secondary.choice.read()) && !(await secondary.chooseNoteFile()))
    return;
  await secondary.followActive();
  await secondary.focus(false);
}

// "AIC Notes: Change Note File": the same choice the code editor reads.
export async function changeNoteFile(secondary) {
  await secondary.choice.read();
  if (await secondary.chooseNoteFile()) await secondary.focus(false);
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
