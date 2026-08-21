import * as vscode from "vscode";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { managedTags, noteTitle, workspaceStateKey } from "../secondary/model.js";
import { structuredError } from "../errors.js";
import { sessionVaultConfig } from "./vault.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 45_000;

function executablePath(context) {
  const configured = vscode.workspace
    .getConfiguration("aicNotes.standardNotes")
    .get("bridgePath", "")
    .trim();
  return configured || path.join(context.extensionPath, "bin", "linux-x64", "aic-notes-sn-bridge");
}

async function assertBridge(context) {
  const bridge = executablePath(context);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(bridge));
  } catch {
    throw structuredError("sn_bridge_missing", `Standard Notes bridge is missing at ${bridge}`, [
      "Install the published Linux x64 VSIX or set aicNotes.standardNotes.bridgePath",
    ]);
  }
  return bridge;
}

export function runBridge(executable, request) {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) {
    return Promise.reject(
      structuredError("sn_request_too_large", "note exceeds the 2 MiB sync request limit", [
        "Reduce the note size before synchronizing",
      ]),
    );
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      executable,
      [],
      {
        encoding: "utf8",
        maxBuffer: MAX_RESPONSE_BYTES,
        timeout: BRIDGE_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        let response;
        try {
          response = JSON.parse(stdout || "{}");
        } catch {
          reject(
            structuredError("sn_bridge_protocol", "bridge returned invalid JSON", [
              "Reinstall the matching AIC Notes VSIX",
            ]),
          );
          return;
        }
        if (error || response.ok === false) {
          const code = response.code || (error?.killed ? "sn_bridge_timeout" : "sn_bridge_failed");
          const message = response.message || stderr.trim() || error?.message || "bridge failed";
          reject(structuredError(code, message, response.fixes ?? ["Check connection and retry"]));
          return;
        }
        resolve(response);
      },
    );
    child.stdin?.end(input);
  });
}

export class StandardNotesSync {
  constructor(context) {
    this.context = context;
  }

  async _invoke(request) {
    const bridge = await assertBridge(this.context);
    const vault = await sessionVaultConfig(this.context);
    return runBridge(bridge, { ...request, ...vault });
  }

  isReadOnly(uri) {
    const state = this.context.workspaceState.get(workspaceStateKey(uri), {});
    return Boolean(state.remoteUuid && state.readOnly);
  }

  async connectionState() {
    try {
      const status = await this._invoke({ operation: "status" });
      return { connected: Boolean(status.connected), reconnect: false };
    } catch (error) {
      const code = error?.structured?.error;
      if (code === "sn_not_connected") return { connected: false, reconnect: false };
      if (code === "sn_vault_unreadable") return { connected: false, reconnect: true };
      throw error;
    }
  }

  async login() {
    return this._connect();
  }

  async logout() {
    await this._invoke({ operation: "disconnect" });
    vscode.window.showInformationMessage("AIC Notes: local Standard Notes session removed");
    return true;
  }

  async _connect() {
    const email = await vscode.window.showInputBox({
      title: "Connect AIC Notes to Standard Notes",
      prompt: "Account email",
      ignoreFocusOut: true,
      validateInput: (value) => (value.includes("@") ? undefined : "Enter a valid email address"),
    });
    if (!email) return false;
    const password = await vscode.window.showInputBox({
      title: "Connect AIC Notes to Standard Notes",
      prompt: "Account password (sent only to the local bridge)",
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) return false;
    const server = vscode.workspace
      .getConfiguration("aicNotes.standardNotes")
      .get("server", "https://api.standardnotes.com");
    let response = await this._invoke({ operation: "connect", email, password, server });
    if (response.mfaRequired) {
      const token = await vscode.window.showInputBox({
        title: "Standard Notes multi-factor authentication",
        prompt: `Enter ${response.tokenName || "MFA"} token`,
        password: true,
        ignoreFocusOut: true,
      });
      if (!token) return false;
      response = await this._invoke({
        operation: "connect",
        email,
        password,
        server,
        tokenName: response.tokenName,
        token,
      });
    }
    vscode.window.showInformationMessage(`AIC Notes: connected to Standard Notes as ${response.email}`);
    return true;
  }

  async ensureConnected() {
    let reconnect = false;
    try {
      const status = await this._invoke({ operation: "status" });
      if (status.connected) return true;
    } catch (error) {
      const code = error?.structured?.error;
      if (code === "sn_vault_unreadable") reconnect = true;
      else if (code !== "sn_not_connected") throw error;
    }
    const choice = await vscode.window.showInformationMessage(
      reconnect
        ? "AIC Notes cannot unlock its local Standard Notes session."
        : "AIC Notes is not connected to Standard Notes.",
      {
        modal: true,
        detail: reconnect
          ? "Reconnect replaces only the unreadable encrypted local session vault; remote notes are unchanged."
          : "The session is encrypted locally; its wrapping key is held by VS Code SecretStorage.",
      },
      reconnect ? "Reconnect" : "Connect",
    );
    return choice === "Connect" || choice === "Reconnect" ? this._connect() : false;
  }

  async sync(uri, markdown, { interactive = true, acceptResult } = {}) {
    if (interactive) {
      if (!(await this.ensureConnected())) return null;
    } else {
      const state = await this.connectionState();
      if (!state.connected) {
        return { action: "disconnected", skipped: true, reconnect: state.reconnect };
      }
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      throw structuredError("sn_outside_workspace", "only workspace sidecars can be synchronized", [
        "Move the note into an open workspace",
      ]);
    }
    const relativePath = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
    const parentPath = relativePath.includes("/")
      ? relativePath.slice(0, relativePath.lastIndexOf("/"))
      : ".";
    const key = workspaceStateKey(uri);
    const previous = this.context.workspaceState.get(key, {});
    const base = {
      operation: "sync",
      localContent: markdown,
      title: noteTitle(relativePath, markdown),
      tags: managedTags(folder.name, parentPath),
      previousTags: Array.isArray(previous.managedTags) ? previous.managedTags : [],
      remoteUuid: previous.remoteUuid || "",
      baseHash: previous.baseHash || "",
    };

    let result = interactive
      ? await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "AIC Notes: synchronizing", cancellable: false },
        () => this._invoke(base),
      )
      : await this._invoke(base);
    if (result.action === "conflict") {
      const resolution = await vscode.window.showWarningMessage(
        "This note changed both locally and in Standard Notes.",
        {
          modal: true,
          detail: "Choose which complete Markdown body becomes authoritative. Nothing is merged silently.",
        },
        "Use Local",
        "Use Standard Notes",
      );
      if (!resolution) return null;
      result = await this._invoke({
        ...base,
        resolution: resolution === "Use Local" ? "local" : "remote",
      });
    }
    if (acceptResult && !(await acceptResult(result))) {
      return { ...result, stale: true };
    }
    await this.context.workspaceState.update(key, {
      remoteUuid: result.remoteUuid,
      baseHash: result.baseHash,
      syncedAt: result.syncedAt,
      readOnly: Boolean(result.readOnly),
      managedTags: Array.isArray(result.managedTags)
        ? result.managedTags
        : Array.isArray(previous.managedTags) ? previous.managedTags : [],
    });
    return result;
  }
}
