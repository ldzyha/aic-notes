import * as vscode from "vscode";
import { normalizeTarget } from "../../vendor/aic-editor-core/note-pages.js";

// The one note file of the product, chosen once and shared by every app.
// Where the extension host runs on Node (desktop, remote) the choice lives in
// the code editor's file `$XDG_CONFIG_HOME/aic/note-file.json` (else
// `~/.config/aic/note-file.json`), `{"schemaVersion":1,"path":"/abs/path"}`.
// A web extension host cannot reach that file and keeps the chosen URI in
// globalState instead.
export const SUGGESTED_NOTE_NAME = "aic.md";
const STATE_KEY = "aicNotes.noteFile";
const CONFIG_LIMIT = 16 * 1024;

// `process.getBuiltinModule` keeps `node:` modules out of both bundles: the
// browser host has no `process` and takes the globalState branch.
function nodeHost() {
  const node = globalThis.process;
  if (typeof node?.getBuiltinModule !== "function") return null;
  return {
    fs: node.getBuiltinModule("node:fs/promises"),
    path: node.getBuiltinModule("node:path"),
    os: node.getBuiltinModule("node:os"),
    crypto: node.getBuiltinModule("node:crypto"),
    env: node.env ?? {},
  };
}

/** Path from note-file.json text, or null when it is not a valid choice. */
export function parseNoteFileConfig(text, isAbsolute) {
  if (typeof text !== "string" || text.length > CONFIG_LIMIT) return null;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const path = value?.schemaVersion === 1 ? value.path : undefined;
  return typeof path === "string" &&
    isAbsolute(path) &&
    !/[\\/]$/u.test(path) &&
    !path.includes("\0")
    ? path
    : null;
}

export class NoteFileChoice {
  /**
   * @param {{ globalState?: any, configDir?: string | null }} options
   *   `configDir` overrides the shared config folder; null forces the
   *   globalState branch.
   */
  constructor({ globalState, configDir } = {}) {
    this.globalState = globalState;
    this.node = configDir === null ? null : nodeHost();
    this.configDir =
      configDir ??
      (this.node
        ? this.node.path.join(
            this.node.env.XDG_CONFIG_HOME ||
              this.node.path.join(this.node.os.homedir(), ".config"),
            "aic",
          )
        : null);
    this.uri = undefined;
    this.problem = "";
  }

  get configFile() {
    return this.configDir
      ? this.node.path.join(this.configDir, "note-file.json")
      : null;
  }

  /** Reads the choice again (it may have changed in the code editor). */
  async read() {
    this.problem = "";
    let uri = null;
    if (this.configFile) {
      try {
        const text = await this.node.fs.readFile(this.configFile, "utf8");
        const path = parseNoteFileConfig(text, this.node.path.isAbsolute);
        if (path) uri = vscode.Uri.file(path);
        else
          this.problem = `${this.configFile} is not a valid note file choice`;
      } catch (error) {
        if (error?.code !== "ENOENT")
          this.problem = `${this.configFile} could not be read`;
      }
    }
    if (!uri && !this.problem) {
      const stored = this.globalState?.get(STATE_KEY);
      if (typeof stored === "string" && stored) uri = vscode.Uri.parse(stored);
    }
    this.uri = uri;
    return uri;
  }

  /** Stores `uri` as the note file for every app that shares the choice. */
  async write(uri) {
    if (this.configFile && uri.scheme === "file") {
      await this.writeConfig(uri.fsPath);
      await this.globalState?.update(STATE_KEY, undefined);
    } else await this.globalState?.update(STATE_KEY, uri.toString());
    this.uri = uri;
    this.problem = "";
  }

  // Atomic and private: a temporary file in the same folder, mode 0600,
  // renamed over note-file.json.
  async writeConfig(path) {
    const { fs, crypto } = this.node;
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });
    const text = `${JSON.stringify({ schemaVersion: 1, path }, null, 2)}\n`;
    const temporary = `${this.configFile}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temporary, text, { mode: 0o600, flag: "wx" });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.configFile);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /** True when `uri` is the chosen note file. */
  isNote(uri) {
    return sameTarget(pageTarget(uri), this.uri && pageTarget(this.uri));
  }

  /**
   * Asks for the note file: an existing Markdown file, or a new one that the
   * first saved edit creates. Returns the chosen URI or undefined.
   */
  async pick() {
    const base = this.uri
      ? this.uri.with({ path: this.uri.path.replace(/\/[^/]*$/u, "") || "/" })
      : (vscode.workspace.workspaceFolders?.[0]?.uri ??
        (this.node ? vscode.Uri.file(this.node.os.homedir()) : undefined));
    const open = "Open an existing Markdown file…";
    const create = `Create a new note file (${SUGGESTED_NOTE_NAME})…`;
    const choice = await vscode.window.showQuickPick([open, create], {
      title: "Choose your note file",
      placeHolder: "One Markdown file holds a page for every file you open",
    });
    let uri;
    if (choice === open)
      [uri] =
        (await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          defaultUri: base,
          filters: { Markdown: ["md", "markdown"] },
          openLabel: "Use as Note File",
          title: "Choose your note file",
        })) ?? [];
    else if (choice === create)
      uri = await vscode.window.showSaveDialog({
        defaultUri: base && vscode.Uri.joinPath(base, SUGGESTED_NOTE_NAME),
        filters: { Markdown: ["md"] },
        saveLabel: "Use as Note File",
        title: "Create your note file",
      });
    if (!uri) return undefined;
    await this.write(uri);
    return uri;
  }
}

/**
 * Page target of a resource: its absolute filesystem path with `/` for a
 * `file:` URI, the full URI for another file system, null for anything that
 * is not a file (untitled buffers, output, diff sides without a provider).
 */
export function pageTarget(uri, api = vscode) {
  if (!uri?.scheme || uri.scheme === "untitled") return null;
  if (uri.scheme === "file") return uri.fsPath.replaceAll("\\", "/") || null;
  return api.workspace.fs.isWritableFileSystem?.(uri.scheme) === undefined
    ? null
    : uri.toString();
}

/** True when both targets are set and equal when normalized. */
export function sameTarget(a, b) {
  return Boolean(a && b && normalizeTarget(a) === normalizeTarget(b));
}
