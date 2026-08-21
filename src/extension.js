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
import { MarkdownEditorProvider } from "./editor/provider.js";
import { structuredError } from "./errors.js";
import { SecondaryNotePane } from "./secondary/provider.js";
import { StandardNotesSync } from "./sync/client.js";
import { linkSelectionToNote } from "./notes/selection.js";
import { deleteNotes } from "./notes/delete.js";
import { AgentWorkflowBootstrap } from "./agents/bootstrap.js";

export function activate(context) {
  AgentWorkflowBootstrap.register(context);
  const tree = new NotesTree();
  const sync = new StandardNotesSync(context);
  const secondary = SecondaryNotePane.register(context, sync);
  context.subscriptions.push(
    tree,
    vscode.window.registerTreeDataProvider("aicNotes.tree", tree),
    MarkdownEditorProvider.register(context),

    vscode.commands.registerCommand(
      "aicNotes.openInSecondary",
      commandHandler((uri, options) => secondary.open(uri, options)),
    ),

    vscode.commands.registerCommand("aicNotes.noteForCurrentFile", commandHandler(noteForCurrentFile)),
    vscode.commands.registerCommand(
      "aicNotes.linkSelectionToNote",
      commandHandler(() => linkSelectionToNote(secondary)),
    ),
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

    // Delete from the notes tree (owner 2026-07-06). Trash first (reversible);
    // if the platform has no trash, the user explicitly chooses permanent —
    // an offered choice, not a silent fallback.
    vscode.commands.registerCommand(
      "aicNotes.deleteNote",
      commandHandler(async (item) => {
        if (item?.uri) await deleteNotes([item.uri], `note "${item.relPath}"`, tree);
      }),
    ),
    vscode.commands.registerCommand(
      "aicNotes.deleteFolderNotes",
      commandHandler(async (item) => {
        const uris = (item?.children ?? []).map((c) => c.uri).filter(Boolean);
        if (uris.length) {
          await deleteNotes(uris, `${uris.length} note(s) under "${item.label}"`, tree);
        }
      }),
    ),

    // Escape hatch for the *.md default claim: a static customEditors selector
    // cannot be toggled by a setting, so this writes the user-level editor
    // association instead — plain markdown back to native, notes stay ours.
    vscode.commands.registerCommand(
      "aicNotes.useNativeForMarkdown",
      commandHandler(async () => {
        const cfg = vscode.workspace.getConfiguration("workbench");
        const current = cfg.get("editorAssociations") ?? {};
        await cfg.update(
          "editorAssociations",
          { ...current, "*.md": "default", "*.note.md": "aicNotes.noteRedirect" },
          vscode.ConfigurationTarget.Global,
        );
        vscode.window.showInformationMessage(
          "AIC Notes: plain *.md now opens in the native editor; *.note.md still routes only to the Secondary Side Bar. Undo via workbench.editorAssociations in user settings.",
        );
      }),
    ),
  );

  hintIfShadowed(context);
}

export function deactivate() {}
