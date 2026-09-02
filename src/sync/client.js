import * as vscode from "vscode";
import { execFile } from "node:child_process";
import * as path from "node:path";
import { chmod } from "node:fs/promises";
import {
  managedTagPath,
  markdownKind,
  noteTitle,
  workspaceStateKey,
} from "../secondary/model.js";
import { structuredError } from "../errors.js";
import { sessionVaultConfig } from "./vault.js";
import { importCandidates } from "./import.js";
import { runWasmBridge } from "./wasm-bridge.js";
import { syncAdmission } from "./admission.js";
import {
  disconnectedSyncResult,
  passiveConnectionState,
} from "./connection-state.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const BRIDGE_TIMEOUT_MS = 45_000;

function executablePath(context) {
  const configured = vscode.workspace
    .getConfiguration("aicNotes.standardNotes")
    .get("bridgePath", "")
    .trim();
  if (configured) return configured;
  const platform =
    process.platform === "win32"
      ? "windows"
      : process.platform === "linux"
        ? "linux"
        : process.platform;
  const architecture = process.arch === "x64" ? "x64" : process.arch;
  const executable =
    process.platform === "win32"
      ? "aic-notes-sn-bridge.exe"
      : "aic-notes-sn-bridge";
  return path.join(
    context.extensionPath,
    "bin",
    `${platform}-${architecture}`,
    executable,
  );
}

async function assertBridge(context) {
  const bridge = executablePath(context);
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(bridge));
  } catch {
    throw structuredError(
      "sn_bridge_missing",
      `Standard Notes bridge is missing at ${bridge}`,
      [
        `Install the published ${process.platform}-${process.arch} VSIX or set aicNotes.standardNotes.bridgePath`,
      ],
    );
  }
  if (process.platform !== "win32") {
    try {
      await chmod(bridge, 0o755);
    } catch {
      throw structuredError(
        "sn_bridge_permissions",
        `Standard Notes bridge is not executable at ${bridge}`,
        [
          "Reinstall the matching Linux VSIX or choose an executable bridgePath",
        ],
      );
    }
  }
  return bridge;
}

export function runBridge(executable, request) {
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) {
    return Promise.reject(
      structuredError(
        "sn_request_too_large",
        "note exceeds the 2 MiB sync request limit",
        ["Reduce the note size before synchronizing"],
      ),
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
            structuredError(
              "sn_bridge_protocol",
              "bridge returned invalid JSON",
              ["Reinstall the matching AIC Notes VSIX"],
            ),
          );
          return;
        }
        if (error || response.ok === false) {
          const code =
            response.code ||
            (error?.killed ? "sn_bridge_timeout" : "sn_bridge_failed");
          const message =
            response.message ||
            stderr.trim() ||
            error?.message ||
            "bridge failed";
          reject(
            structuredError(
              code,
              message,
              response.fixes ?? ["Check connection and retry"],
            ),
          );
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
    const vault = await sessionVaultConfig(this.context);
    const payload = { ...request, ...vault, hostPlatform: process.platform };
    const response =
      process.platform === "win32"
        ? await runWasmBridge(this.context, payload)
        : await runBridge(await assertBridge(this.context), payload);
    if (response?.ok === false) {
      throw structuredError(
        response.code || "sn_bridge_failed",
        response.message || "bridge failed",
        response.fixes ?? ["Check connection and retry"],
      );
    }
    return response;
  }

  isReadOnly(uri) {
    const state = this.context.workspaceState.get(workspaceStateKey(uri), {});
    return Boolean(state.remoteUuid && state.readOnly);
  }

  bindingState(uri) {
    const state = this.context.workspaceState.get(workspaceStateKey(uri), {});
    return {
      bound: Boolean(state.remoteUuid),
      readOnly: Boolean(state.remoteUuid && state.readOnly),
    };
  }

  async connectionState() {
    try {
      const status = await this._invoke({ operation: "status" });
      return {
        connected: Boolean(status.connected),
        reconnect: false,
        available: true,
      };
    } catch (error) {
      const passive = passiveConnectionState(error);
      if (passive) return passive;
      throw error;
    }
  }

  async login() {
    return this._connect();
  }

  async logout() {
    await this._invoke({ operation: "disconnect" });
    vscode.window.showInformationMessage(
      "AIC Notes: local Standard Notes session removed",
    );
    return true;
  }

  async importOpenWorkspaces({ showProgress = true } = {}) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const summary = {
      remote: 0,
      created: 0,
      linked: 0,
      orphaned: 0,
      skipped: 0,
    };
    for (const folder of folders) {
      const pull = () =>
        this._invoke({ operation: "pull-project", project: folder.name });
      const result = showProgress
        ? await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `AIC Notes: importing ${folder.name} from Standard Notes`,
              cancellable: false,
            },
            pull,
          )
        : await pull();
      const remotes = Array.isArray(result.notes) ? result.notes : [];
      const candidates = importCandidates(remotes, folder.name);
      summary.remote += remotes.length;
      summary.skipped += remotes.length - candidates.length;

      for (const candidate of candidates) {
        const targetUri =
          candidate.targetPath === null
            ? null
            : candidate.targetPath
              ? vscode.Uri.joinPath(folder.uri, candidate.targetPath)
              : folder.uri;
        let targetStat;
        if (targetUri) {
          try {
            targetStat = await vscode.workspace.fs.stat(targetUri);
          } catch {
            targetStat = undefined;
          }
        }
        const isDirectory = targetStat
          ? Boolean(targetStat.type & vscode.FileType.Directory)
          : undefined;
        if (
          targetStat &&
          candidate.targetKind &&
          (candidate.targetKind === "directory") !== isDirectory
        ) {
          summary.skipped++;
          continue;
        }

        const noteUri = vscode.Uri.joinPath(folder.uri, candidate.notePath);
        const noteParent = vscode.Uri.joinPath(
          folder.uri,
          path.posix.dirname(candidate.notePath),
        );
        try {
          const parentStat = await vscode.workspace.fs.stat(noteParent);
          if (!(parentStat.type & vscode.FileType.Directory)) {
            summary.skipped++;
            continue;
          }
        } catch {
          // Never materialize a remote directory structure into source code.
          // A note for a missing file/folder is still imported when its actual
          // parent exists, so Explorer can expose it as an orphan.
          summary.skipped++;
          continue;
        }
        const key = workspaceStateKey(noteUri);
        const previous = this.context.workspaceState.get(key, {});
        if (
          previous.remoteUuid &&
          previous.remoteUuid !== candidate.remote.remoteUuid
        ) {
          summary.skipped++;
          continue;
        }

        let noteExists = false;
        let localContent = "";
        try {
          localContent = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(noteUri),
          );
          noteExists = true;
        } catch {
          noteExists = false;
        }
        // A different local body is not an ambiguous identity: the exact
        // project path + note contract already selected this remote. Preserve
        // the local draft, persist the binding/base, and let the next explicit
        // save offer one three-way resolution instead of creating duplicates.
        if (!noteExists) {
          await vscode.workspace.fs.writeFile(
            noteUri,
            new TextEncoder().encode(candidate.remote.localContent),
          );
          summary.created++;
        } else {
          summary.linked++;
        }
        if (targetUri && !targetStat) summary.orphaned++;
        const sameRemote = previous.remoteUuid === candidate.remote.remoteUuid;
        const exactMatch =
          noteExists && localContent === candidate.remote.localContent;
        await this.context.workspaceState.update(key, {
          remoteUuid: candidate.remote.remoteUuid,
          // Preserve the last common ancestor for an existing binding. On a
          // first binding, only identical bodies share the remote base; two
          // different bodies intentionally keep an empty base so a later
          // explicit save asks once instead of silently overwriting either.
          baseHash:
            !noteExists || exactMatch
              ? candidate.remote.baseHash
              : sameRemote
                ? previous.baseHash || ""
                : "",
          syncedAt: result.syncedAt,
          readOnly: Boolean(candidate.remote.readOnly),
          managedTags: Array.isArray(candidate.remote.managedTags)
            ? candidate.remote.managedTags
            : [],
          managedTagUuids: Array.isArray(candidate.remote.managedTagUuids)
            ? candidate.remote.managedTagUuids
            : [],
        });
      }
    }
    return summary;
  }

  async reconcileOpenWorkspaces({ showProgress = false } = {}) {
    const state = await this.connectionState();
    if (!state.connected) {
      return {
        connected: false,
        reconnect: state.reconnect,
        available: state.available,
        imported: null,
        local: 0,
        synced: 0,
        conflicts: 0,
        skipped: 0,
        failed: 0,
      };
    }

    const work = async () => {
      // Pull inventory first so every canonical remote identity is bound
      // before local-only sidecars are pushed.
      let imported;
      try {
        imported = await this.importOpenWorkspaces({ showProgress: false });
      } catch (error) {
        const passive = passiveConnectionState(error);
        if (!passive) throw error;
        return {
          ...passive,
          imported: null,
          local: 0,
          synced: 0,
          conflicts: 0,
          skipped: 0,
          failed: 0,
        };
      }
      const notes = await vscode.workspace.findFiles(
        "**/*.md",
        "{**/node_modules/**,**/.git/**,**/dist/**}",
      );
      const summary = {
        connected: true,
        reconnect: false,
        available: true,
        imported,
        local: notes.length,
        synced: 0,
        conflicts: 0,
        skipped: 0,
        failed: 0,
      };
      for (const uri of notes) {
        let markdown;
        try {
          markdown = new TextDecoder().decode(
            await vscode.workspace.fs.readFile(uri),
          );
          if (
            markdownKind(uri.path) === "note" &&
            !syncAdmission(markdown, "").admit
          ) {
            summary.skipped++;
            continue;
          }
          const result = await this.sync(uri, markdown, {
            interactive: false,
            assumeConnected: true,
            resolveConflicts: false,
            acceptResult: async (candidate) => {
              if (
                typeof candidate.localContent === "string" &&
                candidate.localContent !== markdown
              ) {
                const openDocument = vscode.workspace.textDocuments.find(
                  (document) => document.uri.toString() === uri.toString(),
                );
                if (
                  openDocument?.isDirty ||
                  (openDocument && openDocument.getText() !== markdown)
                )
                  return false;
                await vscode.workspace.fs.writeFile(
                  uri,
                  new TextEncoder().encode(candidate.localContent),
                );
              }
              return true;
            },
          });
          if (result?.action === "disconnected") {
            summary.connected = false;
            summary.reconnect = Boolean(result.reconnect);
            summary.available = result.available !== false;
            summary.skipped++;
            break;
          }
          if (result?.conflict) summary.conflicts++;
          else if (result?.skipped) summary.skipped++;
          else if (result) summary.synced++;
        } catch {
          summary.failed++;
        }
      }
      return summary;
    };

    return showProgress
      ? vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "AIC Notes: reconciling workspace notes",
            cancellable: false,
          },
          work,
        )
      : work();
  }

  async _connect() {
    const email = await vscode.window.showInputBox({
      title: "Connect AIC Notes to Standard Notes",
      prompt: "Account email",
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.includes("@") ? undefined : "Enter a valid email address",
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
    let response = await this._invoke({
      operation: "connect",
      email,
      password,
      server,
    });
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
    vscode.window.showInformationMessage(
      `AIC Notes: connected to Standard Notes as ${response.email}`,
    );
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
    return choice === "Connect" || choice === "Reconnect"
      ? this._connect()
      : false;
  }

  async trash(uri) {
    const key = workspaceStateKey(uri);
    const previous = this.context.workspaceState.get(key, {});
    if (!previous.remoteUuid) return { action: "unbound", bound: false };
    if (!(await this.ensureConnected())) return null;

    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "AIC Notes: moving remote note to Trash",
        cancellable: false,
      },
      () =>
        this._invoke({
          operation: "trash",
          remoteUuid: previous.remoteUuid,
          previousTags: Array.isArray(previous.managedTags)
            ? previous.managedTags
            : [],
          previousTagUuids: Array.isArray(previous.managedTagUuids)
            ? previous.managedTagUuids
            : [],
        }),
    );
    if (result.remoteUuid !== previous.remoteUuid) {
      throw structuredError(
        "sn_remote_identity_changed",
        "Standard Notes returned a different note identity",
        ["Keep the local note and retry after reconnecting"],
      );
    }
    return { ...result, bound: true };
  }

  async completeTrash(uri) {
    await this.context.workspaceState.update(workspaceStateKey(uri), undefined);
  }

  async sync(
    uri,
    markdown,
    {
      interactive = true,
      acceptResult,
      assumeConnected = false,
      resolveConflicts = interactive,
    } = {},
  ) {
    if (interactive) {
      if (!(await this.ensureConnected())) return null;
    } else if (!assumeConnected) {
      const state = await this.connectionState();
      if (!state.connected) {
        return {
          action: "disconnected",
          skipped: true,
          reconnect: state.reconnect,
        };
      }
    }
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
      throw structuredError(
        "sn_outside_workspace",
        "only workspace sidecars can be synchronized",
        ["Move the note into an open workspace"],
      );
    }
    const relativePath = vscode.workspace
      .asRelativePath(uri, false)
      .replaceAll("\\", "/");
    const kind = markdownKind(relativePath);
    if (!kind) {
      throw structuredError(
        "sn_not_markdown",
        "only Markdown files can be synchronized",
        ["Choose a .md or .note.md file inside the workspace"],
      );
    }
    const parentPath = relativePath.includes("/")
      ? relativePath.slice(0, relativePath.lastIndexOf("/"))
      : ".";
    const key = workspaceStateKey(uri);
    const previous = this.context.workspaceState.get(key, {});
    const base = {
      operation: "sync",
      localContent: markdown,
      title: noteTitle(relativePath, markdown),
      kind,
      tags: managedTagPath(folder.name, parentPath),
      previousTags: Array.isArray(previous.managedTags)
        ? previous.managedTags
        : [],
      previousTagUuids: Array.isArray(previous.managedTagUuids)
        ? previous.managedTagUuids
        : [],
      remoteUuid: previous.remoteUuid || "",
      baseHash: previous.baseHash || "",
    };

    const invokeRequest = async (payload, showProgress = false) => {
      try {
        return showProgress
          ? await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: "AIC Notes: synchronizing",
                cancellable: false,
              },
              () => this._invoke(payload),
            )
          : await this._invoke(payload);
      } catch (error) {
        const disconnected = interactive
          ? null
          : disconnectedSyncResult(error);
        if (disconnected) return disconnected;
        throw error;
      }
    };

    let request = base;
    let result = await invokeRequest(request, interactive);
    if (result.action === "disconnected") return result;
    if (result.action === "identity-conflict") {
      if (!resolveConflicts)
        return {
          ...result,
          skipped: true,
          conflict: true,
          identityConflict: true,
        };
      const candidates = Array.isArray(result.identityCandidates)
        ? result.identityCandidates.filter((candidate) => candidate?.remoteUuid)
        : [];
      if (candidates.length === 0) {
        throw structuredError(
          "sn_remote_ambiguous",
          "Standard Notes returned no usable identity candidates",
          ["Reconnect and retry the explicit save"],
        );
      }
      const writable = candidates.find((candidate) => !candidate.readOnly);
      const choices = [];
      if (writable) {
        choices.push({
          label: "$(arrow-up) Keep local file",
          description: "Send this Markdown to Standard Notes",
          detail: "Establish one stable binding; no duplicate note is deleted.",
          remoteUuid: writable.remoteUuid,
          resolution: "local",
        });
      }
      for (const candidate of candidates) {
        const parsedDate = Date.parse(candidate.updatedAt || "");
        const updated = Number.isFinite(parsedDate)
          ? new Intl.DateTimeFormat(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(parsedDate))
          : "date unavailable";
        choices.push({
          label: `$(arrow-down) Use Standard Notes copy · ${updated}`,
          description: candidate.readOnly ? "Read-only" : "",
          detail:
            String(candidate.preview || "").trim() || "Empty Markdown note",
          remoteUuid: candidate.remoteUuid,
          resolution: "remote",
        });
      }
      const selected = await vscode.window.showQuickPick(choices, {
        title: "Resolve duplicate Standard Notes identity",
        placeHolder: "Choose the content to keep for this local file",
        ignoreFocusOut: true,
      });
      if (!selected) return null;
      request = {
        ...base,
        remoteUuid: selected.remoteUuid,
        resolution: selected.resolution,
      };
      result = await invokeRequest(request);
      if (result.action === "disconnected") return result;
    }
    if (result.action === "conflict") {
      if (!resolveConflicts)
        return { ...result, skipped: true, conflict: true };
      const resolution = await vscode.window.showWarningMessage(
        "This note changed both locally and in Standard Notes.",
        {
          modal: true,
          detail:
            "Choose which complete Markdown body becomes authoritative. Nothing is merged silently.",
        },
        "Use Local",
        "Use Standard Notes",
      );
      if (!resolution) return null;
      result = await invokeRequest({
        ...request,
        resolution: resolution === "Use Local" ? "local" : "remote",
      });
      if (result.action === "disconnected") return result;
    }
    if (
      result.action === "conflict" ||
      result.action === "identity-conflict"
    ) {
      throw structuredError(
        "sn_conflict_unresolved",
        "the selected Standard Notes conflict resolution was not applied",
        ["Reconnect and retry the explicit save"],
      );
    }
    await this.context.workspaceState.update(key, {
      remoteUuid: result.remoteUuid,
      baseHash: result.baseHash,
      syncedAt: result.syncedAt,
      readOnly: Boolean(result.readOnly),
      managedTags: Array.isArray(result.managedTags)
        ? result.managedTags
        : Array.isArray(previous.managedTags)
          ? previous.managedTags
          : [],
      managedTagUuids: Array.isArray(result.managedTagUuids)
        ? result.managedTagUuids
        : Array.isArray(previous.managedTagUuids)
          ? previous.managedTagUuids
          : [],
    });
    const accepted = !acceptResult || (await acceptResult(result));
    return accepted ? result : { ...result, stale: true };
  }
}
