// aic-notes — sidecar *.note.md notes + aic-style markdown editing.
// activate(): the notes tree, the note commands, explorer nesting, and (P2)
// the custom markdown editor.

import * as vscode from "vscode";
import { NotesTree } from "./notes/tree.js";
import {
  noteForCurrentFile,
  noteForExplorerItem,
  openProjectNote,
  openGlobalNote,
  openNoteDocument,
  commandHandler,
} from "./notes/create.js";
import { enableExplorerNesting, hintIfShadowed } from "./notes/nesting.js";
import { resolveTarget } from "./notes/target.js";
import { structuredError } from "./errors.js";

export function activate(context) {
  const tree = new NotesTree();
  context.subscriptions.push(
    tree,
    vscode.window.registerTreeDataProvider("aicNotes.tree", tree),

    vscode.commands.registerCommand("aicNotes.noteForCurrentFile", commandHandler(noteForCurrentFile)),
    vscode.commands.registerCommand("aicNotes.noteForExplorerItem", commandHandler(noteForExplorerItem)),
    vscode.commands.registerCommand("aicNotes.openProjectNote", commandHandler(openProjectNote)),
    vscode.commands.registerCommand("aicNotes.openGlobalNote", commandHandler(openGlobalNote)),
    vscode.commands.registerCommand("aicNotes.refreshTree", () => tree.refresh()),
    vscode.commands.registerCommand("aicNotes.enableExplorerNesting", commandHandler(enableExplorerNesting)),

    vscode.commands.registerCommand(
      "aicNotes.openTarget",
      commandHandler(async (item) => {
        if (!item?.relPath || !item?.folder) return;
        const target = await resolveTarget(item.folder, item.relPath);
        if (!target) {
          throw structuredError("notes_orphan", `${item.relPath} has no existing target`, [
            "The annotated file/folder was moved or deleted — restore it or delete the note",
          ]);
        }
        await vscode.window.showTextDocument(target);
      }),
    ),
    vscode.commands.registerCommand(
      "aicNotes.copyWikiLink",
      commandHandler(async (item) => {
        if (!item?.relPath) return;
        const stem = item.relPath.replace(/\.note\.md$/, "");
        await vscode.env.clipboard.writeText(`[[${stem}]]`);
      }),
    ),
    vscode.commands.registerCommand("aicNotes.openNote", commandHandler(openNoteDocument)),
  );

  hintIfShadowed(context);
}

export function deactivate() {}
