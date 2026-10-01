import * as vscode from "vscode";
import { randomHex } from "../host-runtime.js";
import { assertWritableResource, resourceLabel } from "../notes/resources.js";
import { structuredError, formatError } from "../errors.js";
import { AGENT_GUIDE } from "../../vendor/aic-editor-core/agent-guide.js";
import {
  AGENT_MARKER_PATH,
  agentGuideIdentity,
  encodeAgentMarker,
  validateAgentMarker,
} from "./contract.js";

async function stat(uri) {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (error?.code === "FileNotFound") return undefined;
    throw error;
  }
}

async function readRegular(uri) {
  const info = await stat(uri);
  if (!info) return null;
  if (
    info.type & vscode.FileType.SymbolicLink ||
    !(info.type & vscode.FileType.File)
  ) {
    throw structuredError(
      "agent_file_unsafe",
      `${resourceLabel(uri)} is not a regular file`,
      ["Choose a workspace with regular AIC instruction files"],
    );
  }
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

async function chooseFolder(uri) {
  if (uri) return vscode.workspace.getWorkspaceFolder(uri) ?? undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: resourceLabel(folder.uri),
      folder,
    })),
    {
      title: "Enable the AIC agent workflow",
      placeHolder: "Choose a workspace folder",
    },
  );
  return picked?.folder;
}

async function writeAtomic(directory, destination, text, overwrite) {
  const temporary = vscode.Uri.joinPath(
    directory,
    `.aic-agent-${randomHex(16)}.tmp`,
  );
  try {
    await vscode.workspace.fs.writeFile(
      temporary,
      new TextEncoder().encode(text),
    );
    await vscode.workspace.fs.rename(temporary, destination, { overwrite });
  } finally {
    try {
      await vscode.workspace.fs.delete(temporary);
    } catch {
      /* Consumed by rename. */
    }
  }
}

export class AgentWorkflowBootstrap {
  static register(context) {
    const bootstrap = new AgentWorkflowBootstrap();
    context.subscriptions.push(
      vscode.commands.registerCommand("aicNotes.enableAgentWorkflow", (uri) =>
        bootstrap.enable(uri).catch((error) => bootstrap.report(error)),
      ),
      vscode.commands.registerCommand("aicNotes.syncAgentInstructions", () =>
        bootstrap.enable().catch((error) => bootstrap.report(error)),
      ),
      vscode.commands.registerCommand("aicNotes.copyAgentInstructions", () =>
        vscode.env.clipboard
          .writeText(AGENT_GUIDE)
          .catch((error) => bootstrap.report(error)),
      ),
    );
    // Installation, upgrade and workspace trust changes never run an executable
    // or rewrite instructions. Setup is an explicit local command.
    return bootstrap;
  }

  report(error) {
    vscode.window.showWarningMessage(`AIC Notes — ${formatError(error)}`);
  }

  async enable(uri) {
    if (!vscode.workspace.isTrusted) {
      throw structuredError(
        "agent_workspace_untrusted",
        "Workspace instruction setup is disabled here",
        [
          "Trust the workspace or use Copy Agent Instructions without writing files",
        ],
      );
    }
    const folder = await chooseFolder(uri);
    if (!folder) return;
    assertWritableResource(folder.uri);
    const directory = vscode.Uri.joinPath(folder.uri, AGENT_MARKER_PATH[0]);
    const directoryInfo = await stat(directory);
    if (
      directoryInfo &&
      (directoryInfo.type & vscode.FileType.SymbolicLink ||
        !(directoryInfo.type & vscode.FileType.Directory))
    ) {
      throw structuredError(
        "agent_directory_unsafe",
        `${resourceLabel(directory)} is not a regular directory`,
        [
          "Review the workspace .vscode directory before enabling agent instructions",
        ],
      );
    }
    const marker = vscode.Uri.joinPath(folder.uri, ...AGENT_MARKER_PATH);
    const previous = await readRegular(marker);
    if (previous !== null) {
      let parsed;
      try {
        parsed = JSON.parse(previous);
      } catch {
        /* Not an owned marker. */
      }
      if (!validateAgentMarker(parsed)) {
        throw structuredError(
          "agent_marker_owned",
          `${resourceLabel(marker)} is not an AIC Notes marker`,
          [
            "Review or move the existing file before enabling the AIC agent workflow",
          ],
        );
      }
    }
    const identity = await agentGuideIdentity();
    const guide = vscode.Uri.joinPath(folder.uri, ...identity.path);
    const existingGuide = await readRegular(guide);
    if (existingGuide !== null && existingGuide !== AGENT_GUIDE) {
      throw structuredError(
        "agent_instructions_modified",
        "The bundled instruction copy has been edited",
        [
          "Keep your edits and use Copy Agent Instructions, or move the edited file before retrying",
        ],
      );
    }
    await vscode.workspace.fs.createDirectory(directory);
    // Content-addressed files are immutable. Updating never overwrites authored
    // Markdown, AGENTS.md, provider config, or an older instruction version.
    if (existingGuide === null)
      await writeAtomic(directory, guide, AGENT_GUIDE, false);
    const markerText = await encodeAgentMarker();
    if (previous !== markerText)
      await writeAtomic(directory, marker, markerText, previous !== null);
    const choice = await vscode.window.showInformationMessage(
      "AIC Notes: instructions are ready. Give the instruction file to your coding agent.",
      "Copy handoff",
    );
    if (choice === "Copy handoff") {
      await vscode.env.clipboard.writeText(
        `Read ${JSON.stringify(resourceLabel(guide))} for the AIC instructions, then follow my task request.`,
      );
    }
    return { state: "current", guide: resourceLabel(guide) };
  }
}
