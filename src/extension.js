// aic-notes — one workspace note (aic.md) with a page per file + aic-style
// markdown editing. activate(): the Secondary pane, its reveal command and the
// custom markdown editor.

import * as vscode from "vscode";
import { noteForCurrentFile, commandHandler } from "./notes/create.js";
import { MarkdownEditorProvider } from "./editor/provider.js";
import { registerMarkdownSlashCompletionProvider } from "./editor/slash-provider.js";
import { SecondaryNotePane } from "./secondary/provider.js";
import { NoteEditOwnership } from "./notes/edit-ownership.js";
import { AgentWorkflowBootstrap } from "./agents/bootstrap.js";
import { removeRetiredAuthData } from "./retired-auth-cleanup.js";

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
      vscode.workspace.fs
        .delete(
          vscode.Uri.joinPath(context.globalStorageUri, "standard-notes"),
          { recursive: true, useTrash: false },
        )
        .then(undefined, (error) => {
          if (error?.code !== "FileNotFound" && error?.code !== "ENOENT")
            throw error;
        }),
    );
  }
  const results = await Promise.allSettled(removals);
  if (results.every((result) => result.status === "fulfilled"))
    await context.globalState.update(RETIRED_SYNC_CLEANUP_KEY, true);
}

export async function activate(context) {
  await removeRetiredSyncData(context);
  await removeRetiredAuthData(context);
  AgentWorkflowBootstrap.register(context);
  const ownership = new NoteEditOwnership();
  const secondary = SecondaryNotePane.register(context, ownership);
  const markdownEditor = MarkdownEditorProvider.register(context, ownership);
  context.subscriptions.push(
    markdownEditor,
    registerMarkdownSlashCompletionProvider(vscode),

    vscode.commands.registerCommand(
      "aicNotes.noteForCurrentFile",
      commandHandler(() => noteForCurrentFile(secondary)),
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
            "*.note.md": "aicNotes.markdown",
          },
          vscode.ConfigurationTarget.Global,
        );
        vscode.window.showInformationMessage(
          "AIC Notes: plain *.md now opens in the native editor; *.note.md opens in the main AIC editor. Undo via workbench.editorAssociations in user settings.",
        );
      }),
    ),
  );
}

export function deactivate() {}
