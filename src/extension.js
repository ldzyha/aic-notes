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
import { structuredError, formatError } from "./errors.js";
import { SecondaryNotePane } from "./secondary/provider.js";
import { StandardNotesSync } from "./sync/client.js";
import { linkSelectionToNote } from "./notes/selection.js";
import { deleteNotes } from "./notes/delete.js";
import { AgentWorkflowBootstrap } from "./agents/bootstrap.js";
import { stampFileProperties } from "../vendor/aic-editor-core/file-properties.js";

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

export function activate(context) {
  AgentWorkflowBootstrap.register(context);
  const tree = new NotesTree();
  const sync = new StandardNotesSync(context);
  const secondary = SecondaryNotePane.register(context, sync);
  const markdownEditor = MarkdownEditorProvider.register(context);
  const remoteFirstTrash = (uris) => {
    const bound = uris.filter((uri) => sync.bindingState(uri).bound);
    return {
      detail: bound.length
        ? `${bound.length} bound Standard Notes item(s) move to remote Trash before local files.`
        : "These notes have no Standard Notes binding; only local files move to Trash.",
      beforeDelete: async () => {
        for (const uri of bound) {
          if (!(await sync.trash(uri))) return false;
        }
        return true;
      },
      afterDelete: async (uri) => {
        if (bound.some((candidate) => candidate.toString() === uri.toString()))
          await sync.completeTrash(uri);
      },
    };
  };
  const explicitDocumentSaves = new Set();
  const applyingDocumentPulls = new Set();
  const documentWillSave = vscode.workspace.onWillSaveTextDocument((event) => {
    const lowerPath = event.document.uri.path.toLowerCase();
    if (
      !lowerPath.endsWith(".md") ||
      lowerPath.endsWith(".note.md") ||
      !vscode.workspace.getWorkspaceFolder(event.document.uri)
    )
      return;
    const saveKey = event.document.uri.toString();
    if (applyingDocumentPulls.has(saveKey)) {
      explicitDocumentSaves.delete(saveKey);
      return;
    }
    if (event.reason === vscode.TextDocumentSaveReason.Manual) {
      explicitDocumentSaves.add(saveKey);
      event.waitUntil(legacyPropertyCleanupEdits(event.document));
    } else explicitDocumentSaves.delete(saveKey);
  });
  const documentSync = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      const saveKey = document.uri.toString();
      if (
        !document.uri.path.toLowerCase().endsWith(".md") ||
        document.uri.path.toLowerCase().endsWith(".note.md") ||
        !vscode.workspace.getWorkspaceFolder(document.uri) ||
        !explicitDocumentSaves.delete(saveKey)
      )
        return;
      try {
        const captured = document.getText();
        const result = await sync.sync(document.uri, captured, {
          interactive: false,
          resolveConflicts: true,
          acceptResult: async (candidate) => {
            if (
              typeof candidate.localContent !== "string" ||
              candidate.localContent === captured
            )
              return true;
            if (document.isDirty || document.getText() !== captured)
              return false;
            const edit = new vscode.WorkspaceEdit();
            edit.replace(
              document.uri,
              new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length),
              ),
              candidate.localContent,
            );
            applyingDocumentPulls.add(saveKey);
            try {
              return (
                (await vscode.workspace.applyEdit(edit)) &&
                (await document.save())
              );
            } finally {
              applyingDocumentPulls.delete(saveKey);
            }
          },
        });
        if (result?.action === "disconnected") {
          vscode.window.setStatusBarMessage(
            "AIC Notes: document saved locally · log in to sync",
            4000,
          );
        } else if (result?.stale) {
          vscode.window.setStatusBarMessage(
            "AIC Notes: changed during sync · local edit kept · save again",
            5000,
          );
        } else if (result && !result.skipped) {
          vscode.window.setStatusBarMessage(
            `AIC Notes: document synchronized · ${result.action}`,
            3000,
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(`AIC Notes — ${formatError(error)}`);
      }
    },
  );
  context.subscriptions.push(
    tree,
    documentWillSave,
    documentSync,
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
      "aicNotes.syncCurrentNote",
      commandHandler(() => secondary.syncCurrent()),
    ),
    vscode.commands.registerCommand(
      "aicNotes.pullProjectNotes",
      commandHandler(() => secondary.importProjectNotes()),
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
          const trash = remoteFirstTrash([item.uri]);
          await deleteNotes(
            [item.uri],
            `note "${item.relPath}"`,
            tree,
            trash.detail,
            trash.beforeDelete,
            trash.afterDelete,
          );
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
          const trash = remoteFirstTrash(uris);
          await deleteNotes(
            uris,
            `${uris.length} note(s) under "${item.label}"`,
            tree,
            trash.detail,
            trash.beforeDelete,
            trash.afterDelete,
          );
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
  queueMicrotask(() => {
    secondary
      .initializeWorkspaceSync()
      .catch((error) => secondary.reportSyncError(error));
  });
}

export function deactivate() {}
