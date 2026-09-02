// aic-notes — sidecar *.note.md notes + aic-style markdown editing.
// activate(): the notes tree, the note commands, explorer nesting, and (P2)
// the custom markdown editor.

import * as vscode from "vscode";
import { NotesTree } from "./notes/tree.js";
import {
  noteForCurrentFile,
  noteForExplorerItem,
  openProjectNote,
  openNoteDocument,
  commandHandler,
} from "./notes/create.js";
import { enableExplorerNesting, hintIfShadowed } from "./notes/nesting.js";
import { resolveTarget } from "./notes/target.js";
import { MarkdownEditorProvider } from "./editor/provider.js";
import { structuredError } from "./errors.js";
import { SecondaryNotePane } from "./secondary/provider.js";
import { linkSelectionToNote } from "./notes/selection.js";
import { deleteNotes } from "./notes/delete.js";
import { AgentWorkflowBootstrap } from "./agents/bootstrap.js";
import { stampFileProperties } from "../vendor/aic-editor-core/file-properties.js";

const RETIRED_SYNC_STATE_PREFIX = "aicNotes.standardNotes.";
const RETIRED_SYNC_SECRET = "aicNotes.standardNotes.vaultKey.v1";
const RETIRED_SYNC_CLEANUP_KEY = "aicNotes.migrations.standardNotesRemoved.v22";

async function removeRetiredSyncData(context) {
  if (context.globalState.get(RETIRED_SYNC_CLEANUP_KEY, false)) return;
  const removals = [
    context.secrets.delete(RETIRED_SYNC_SECRET),
    ...context.workspaceState
      .keys()
      .filter((key) => key.startsWith(RETIRED_SYNC_STATE_PREFIX))
      .map((key) => context.workspaceState.update(key, undefined)),
  ];
  if (context.globalStorageUri) {
    removals.push(
      vscode.workspace.fs.delete(
        vscode.Uri.joinPath(context.globalStorageUri, "standard-notes"),
        { recursive: true, useTrash: false },
      ),
    );
  }
  await Promise.allSettled(removals);
  await context.globalState.update(RETIRED_SYNC_CLEANUP_KEY, true);
}

function legacyPropertyCleanupEdits(document) {
  const relativePath = vscode.workspace
    .asRelativePath(document.uri, false)
    .replaceAll("\\", "/");
  const fileName = relativePath.split("/").pop() ?? "";
  const source = document.getText();
  const cleaned = stampFileProperties(source, {
    fileName,
    updatedAt: new Date().toISOString(),
  });
  if (cleaned === source) return [];
  return [
    vscode.TextEdit.replace(
      new vscode.Range(document.positionAt(0), document.positionAt(source.length)),
      cleaned,
    ),
  ];
}

export async function activate(context) {
  await removeRetiredSyncData(context);
  AgentWorkflowBootstrap.register(context);
  const tree = new NotesTree();
  const secondary = SecondaryNotePane.register(context);
  const markdownEditor = MarkdownEditorProvider.register(context);
  const documentWillSave = vscode.workspace.onWillSaveTextDocument((event) => {
    const lowerPath = event.document.uri.path.toLowerCase();
    if (
      !lowerPath.endsWith(".md") ||
      lowerPath.endsWith(".note.md") ||
      !vscode.workspace.getWorkspaceFolder(event.document.uri)
    )
      return;
    if (event.reason === vscode.TextDocumentSaveReason.Manual) {
      event.waitUntil(legacyPropertyCleanupEdits(event.document));
    }
  });
  context.subscriptions.push(
    tree,
    documentWillSave,
    vscode.window.registerTreeDataProvider("aicNotes.tree", tree),
    markdownEditor,

    vscode.commands.registerCommand(
      "aicNotes.openInSecondary",
      commandHandler((uri, options) => secondary.open(uri, options)),
    ),

    vscode.commands.registerCommand(
      "aicNotes.noteForCurrentFile",
      commandHandler(() => noteForCurrentFile(secondary)),
    ),
    vscode.commands.registerCommand(
      "aicNotes.linkSelectionToNote",
      commandHandler(() => linkSelectionToNote(secondary, markdownEditor)),
    ),
    vscode.commands.registerCommand(
      "aicNotes.noteForExplorerItem",
      commandHandler((uri) => noteForExplorerItem(uri, secondary)),
    ),
    vscode.commands.registerCommand(
      "aicNotes.openProjectNote",
      commandHandler((uri) => openProjectNote(secondary, uri)),
    ),
    vscode.commands.registerCommand("aicNotes.refreshTree", () =>
      tree.refresh(),
    ),
    vscode.commands.registerCommand(
      "aicNotes.enableExplorerNesting",
      commandHandler(enableExplorerNesting),
    ),

    vscode.commands.registerCommand(
      "aicNotes.openTarget",
      commandHandler(async (item) => {
        if (!item?.relPath || !item?.folder) return;
        const target = await resolveTarget(item.folder, item.relPath);
        if (!target) {
          throw structuredError(
            "notes_orphan",
            `${item.relPath} has no existing target`,
            [
              "The annotated file/folder was moved or deleted — restore it or delete the note",
            ],
          );
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
    vscode.commands.registerCommand(
      "aicNotes.openNote",
      commandHandler(openNoteDocument),
    ),

    // Delete from the notes tree (owner 2026-07-06). Trash first (reversible);
    // if the platform has no trash, the user explicitly chooses permanent —
    // an offered choice, not a silent fallback.
    vscode.commands.registerCommand(
      "aicNotes.deleteNote",
      commandHandler(async (item) => {
        if (item?.uri) {
          await deleteNotes([item.uri], `note "${item.relPath}"`, tree);
        }
      }),
    ),
    vscode.commands.registerCommand(
      "aicNotes.deleteFolderNotes",
      commandHandler(async (item) => {
        const uris = (item?.children ?? [])
          .filter((child) => child.kind === "note")
          .map((child) => child.uri)
          .filter(Boolean);
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
          {
            ...current,
            "*.md": "default",
            "*.note.md": "aicNotes.noteRedirect",
          },
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
