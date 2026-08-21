import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { structuredError, formatError } from "../errors.js";
import {
  AGENT_MARKER_PATH,
  MIN_AIC_RULES_VERSION,
  classifyRulesStatus,
  encodeAgentMarker,
  validateAgentMarker,
} from "./contract.js";

const ACTIVATED_VERSION_KEY = "aicNotes.agentWorkflow.activatedVersion";
const PROMPTED_VERSION_KEY = "aicNotes.agentWorkflow.promptedVersion";
const MAX_OUTPUT_BYTES = 1024 * 1024;

function executable() {
  return vscode.workspace.getConfiguration("aicNotes.agentWorkflow").get("aicPath", "aic").trim() || "aic";
}

export function runAic(args) {
  return new Promise((resolve, reject) => {
    execFile(
      executable(),
      args,
      { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES, timeout: 15_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const missing = error.code === "ENOENT";
          reject(
            structuredError(
              missing ? "aic_cli_missing" : "aic_rules_failed",
              missing ? `AIC executable was not found: ${executable()}` : stderr.trim() || error.message,
              missing
                ? ["Install AIC or configure aicNotes.agentWorkflow.aicPath"]
                : ["Run the same AIC rules command in a terminal and inspect its structured error"],
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(
            structuredError("aic_rules_protocol", "AIC returned invalid JSON", [
              "Update AIC and retry with a new agent session",
            ]),
          );
        }
      },
    );
  });
}

async function stat(uri) {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error) {
    if (error?.code === "FileNotFound") return undefined;
    throw error;
  }
}

function markerUri(folder) {
  return vscode.Uri.joinPath(folder.uri, ...AGENT_MARKER_PATH);
}

async function readMarker(folder) {
  const uri = markerUri(folder);
  const info = await stat(uri);
  if (!info) return { uri, exists: false, valid: false };
  if (info.type & vscode.FileType.SymbolicLink || !(info.type & vscode.FileType.File)) {
    throw structuredError("agent_marker_unsafe", `${uri.fsPath} is not a regular file`, [
      "Replace it with a regular .vscode/aic-agent.json file",
    ]);
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(uri)));
    return { uri, exists: true, valid: validateAgentMarker(parsed), parsed };
  } catch {
    return { uri, exists: true, valid: false };
  }
}

async function chooseFolder(uri) {
  if (uri) return vscode.workspace.getWorkspaceFolder(uri) ?? undefined;
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0];
  const picked = await vscode.window.showQuickPick(
    folders.map((folder) => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: "Enable the AIC agent workflow", placeHolder: "Choose a workspace folder" },
  );
  return picked?.folder;
}

async function writeMarker(folder) {
  const directory = vscode.Uri.joinPath(folder.uri, AGENT_MARKER_PATH[0]);
  const destination = markerUri(folder);
  const existing = await readMarker(folder);
  if (existing.exists && !existing.valid) {
    throw structuredError("agent_marker_owned", `${destination.fsPath} is not an AIC Notes marker`, [
      "Review or move the existing file before enabling the AIC agent workflow",
    ]);
  }
  await vscode.workspace.fs.createDirectory(directory);
  const temporary = vscode.Uri.joinPath(
    directory,
    `.aic-agent-${process.pid}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await vscode.workspace.fs.writeFile(
      temporary,
      new TextEncoder().encode(
        encodeAgentMarker(
          Math.max(
            MIN_AIC_RULES_VERSION,
            Number(existing.parsed?.minimumRulesVersion) || 0,
          ),
        ),
      ),
    );
    await vscode.workspace.fs.rename(temporary, destination, { overwrite: true });
  } finally {
    try {
      await vscode.workspace.fs.delete(temporary);
    } catch {
      // The successful atomic rename already consumed the temporary file.
    }
  }
  return destination;
}

export class AgentWorkflowBootstrap {
  static register(context) {
    const bootstrap = new AgentWorkflowBootstrap(context);
    context.subscriptions.push(
      vscode.commands.registerCommand("aicNotes.enableAgentWorkflow", (uri) =>
        bootstrap.enable(uri).catch((error) => bootstrap.report(error)),
      ),
      vscode.commands.registerCommand("aicNotes.syncAgentInstructions", () =>
        bootstrap.sync(true).catch((error) => bootstrap.report(error)),
      ),
    );
    queueMicrotask(() => bootstrap.activate().catch((error) => bootstrap.report(error)));
    return bootstrap;
  }

  constructor(context) {
    this.context = context;
  }

  report(error) {
    vscode.window.showWarningMessage(`AIC Notes — ${formatError(error)}`);
  }

  async workspaceHasMarker() {
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if ((await readMarker(folder)).valid) return true;
    }
    return false;
  }

  async sync(notify = false) {
    const statusPayload = await runAic(["rules", "status", "--json"]);
    const status = classifyRulesStatus(statusPayload);
    if (status.state === "versionSkew") {
      throw structuredError("aic_rules_version_skew", "The installed AIC rule contract is incompatible", [
        `Install AIC with rules version ${MIN_AIC_RULES_VERSION} or newer`,
      ]);
    }
    if (status.unmanaged) {
      throw structuredError("aic_rules_unmanaged", "One or more global instruction files are owner-managed", [
        "Use the official AIC installer or review `aic rules sync --replace-global-instructions --json` before replacing them",
      ]);
    }
    if (status.state === "current") {
      if (notify) vscode.window.showInformationMessage("AIC Notes: agent instructions are current");
      return status;
    }
    const synced = await runAic(["rules", "sync", "--json"]);
    const result = classifyRulesStatus(synced?.status);
    if (result.state !== "current") {
      throw structuredError("aic_rules_sync_incomplete", "AIC did not report current agent instructions", [
        "Run `aic rules status --json` and inspect every managed target",
      ]);
    }
    vscode.window.showInformationMessage(
      "AIC Notes: agent instructions updated. Start a new agent session to load them.",
    );
    return result;
  }

  async enable(uri) {
    if (!vscode.workspace.isTrusted) {
      throw structuredError("agent_workspace_untrusted", "Agent workflow bootstrap is disabled here", [
        "Trust the workspace, review its files, and run Enable AIC Agent Workflow again",
      ]);
    }
    const folder = await chooseFolder(uri);
    if (!folder) return;
    const destination = await writeMarker(folder);
    await this.sync(false);
    vscode.window.showInformationMessage(
      `AIC Notes: enabled portable agent workflow at ${vscode.workspace.asRelativePath(destination, false)}`,
    );
  }

  async activate() {
    const version = String(this.context.extension?.packageJSON?.version ?? "unknown");
    const previous = this.context.globalState.get(ACTIVATED_VERSION_KEY, "");
    const hasMarker = await this.workspaceHasMarker();
    if (previous !== version || hasMarker) {
      try {
        await this.sync(false);
      } catch (error) {
        this.report(error);
      }
      await this.context.globalState.update(ACTIVATED_VERSION_KEY, version);
    }
    if (
      vscode.workspace.isTrusted &&
      !hasMarker &&
      this.context.workspaceState.get(PROMPTED_VERSION_KEY, "") !== version &&
      (vscode.workspace.workspaceFolders?.length ?? 0) > 0
    ) {
      await this.context.workspaceState.update(PROMPTED_VERSION_KEY, version);
      const choice = await vscode.window.showInformationMessage(
        "Enable the portable AIC agent workflow for this project?",
        { detail: "Creates only .vscode/aic-agent.json. AIC remains the rule and context authority." },
        "Enable",
      );
      if (choice === "Enable") await this.enable();
    }
  }
}
