// The notes explorer — a TreeDataProvider mirroring aic's explorer fold-in
// (aic web/src/find.js withNotes): every *.note.md shown against the thing it
// annotates. Shape per workspace folder:
//   global note (~/.config/aic/note.md, pinned, cross-project)
//   project note (<rootName>.note.md at root)
//   .aic/notes/ bucket ("project globals")
//   directory hierarchy of the remaining notes
// Level badge comes from frontmatter (lazy 1 KB read, mtime-cached);
// agent-hidden notes get a lock icon; a note whose target is gone is an orphan.

import * as vscode from "vscode";
import * as os from "node:os";
import * as path from "node:path";
import { noteTargetStem } from "./paths.js";
import { parseFrontmatter, isAgentVisible } from "./frontmatter.js";
import { targetKind } from "./target.js";

export const GLOBAL_NOTE_PATH = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
  "aic",
  "note.md",
);

const EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/.*/**}";

// one tree element; kind: global | project | bucket | dir | note
class Item {
  constructor(kind, label, opts = {}) {
    this.kind = kind;
    this.label = label;
    Object.assign(this, opts);
  }
}

export class NotesTree {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    this._badgeCache = new Map(); // fsPath → { mtime, level, visible }
    this._watcher = vscode.workspace.createFileSystemWatcher("**/*.note.md");
    for (const ev of ["onDidCreate", "onDidChange", "onDidDelete"]) {
      this._watcher[ev](() => this.refresh());
    }
  }

  dispose() {
    this._watcher.dispose();
    this._emitter.dispose();
  }

  refresh() {
    this._badgeCache.clear();
    this._emitter.fire(undefined);
  }

  // ---- data -----------------------------------------------------------

  async _notesFor(folder) {
    const rel = (p) => new vscode.RelativePattern(folder, p);
    const [main, bucket] = await Promise.all([
      vscode.workspace.findFiles(rel("**/*.note.md"), rel(EXCLUDE)),
      vscode.workspace.findFiles(rel(".aic/notes/*.note.md")),
    ]);
    const seen = new Map();
    for (const uri of [...main, ...bucket]) {
      seen.set(uri.fsPath, vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/"));
    }
    return [...seen.entries()]
      .map(([fsPath, relPath]) => ({ uri: vscode.Uri.file(fsPath), relPath }))
      .sort((a, b) => a.relPath.localeCompare(b.relPath));
  }

  async _badge(uri) {
    let stat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch {
      return { level: undefined, visible: true };
    }
    const hit = this._badgeCache.get(uri.fsPath);
    if (hit && hit.mtime === stat.mtime) return hit;
    let level, visible = true;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const head = new TextDecoder().decode(bytes.slice(0, 1024));
      level = parseFrontmatter(head).meta.level;
      visible = isAgentVisible(head);
    } catch {
      /* unreadable → plain badge */
    }
    const entry = { mtime: stat.mtime, level, visible };
    this._badgeCache.set(uri.fsPath, entry);
    return entry;
  }

  // ---- TreeDataProvider -------------------------------------------------

  async getChildren(element) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!element) {
      const roots = [new Item("global", "global note")];
      if (folders.length === 1) return [...roots, ...(await this._folderChildren(folders[0]))];
      for (const f of folders) roots.push(new Item("root", f.name, { folder: f }));
      return roots;
    }
    if (element.kind === "root") return this._folderChildren(element.folder);
    if (element.kind === "bucket" || element.kind === "dir") return element.children;
    return [];
  }

  async _folderChildren(folder) {
    const notes = await this._notesFor(folder);
    const projectNoteRel = `${folder.name}.note.md`;
    const items = [];
    const bucket = [];
    const byDir = new Map(); // top-level dir → notes under it

    for (const n of notes) {
      if (n.relPath === projectNoteRel) {
        items.push(new Item("note", folder.name, { uri: n.uri, relPath: n.relPath, folder, forcedLevel: "project" }));
      } else if (n.relPath.startsWith(".aic/notes/")) {
        bucket.push(new Item("note", path.basename(n.relPath), { uri: n.uri, relPath: n.relPath, folder, forcedLevel: "global" }));
      } else {
        const top = n.relPath.includes("/") ? n.relPath.slice(0, n.relPath.indexOf("/")) : "";
        if (!byDir.has(top)) byDir.set(top, []);
        byDir.get(top).push(n);
      }
    }
    if (bucket.length) items.push(new Item("bucket", "project globals (.aic/notes)", { children: bucket }));

    const rootNotes = byDir.get("") ?? [];
    byDir.delete("");
    for (const [dir, dirNotes] of [...byDir.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      items.push(
        new Item("dir", dir, {
          children: dirNotes.map(
            (n) => new Item("note", this._noteLabel(n.relPath), { uri: n.uri, relPath: n.relPath, folder }),
          ),
        }),
      );
    }
    for (const n of rootNotes) {
      items.push(new Item("note", this._noteLabel(n.relPath), { uri: n.uri, relPath: n.relPath, folder }));
    }
    return items;
  }

  _noteLabel(relPath) {
    const t = noteTargetStem(relPath);
    return t ? t.stem.slice(t.stem.lastIndexOf("/") + 1) : path.basename(relPath);
  }

  async getTreeItem(element) {
    if (element.kind === "global") {
      let exists = true;
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(GLOBAL_NOTE_PATH));
      } catch {
        exists = false;
      }
      const item = new vscode.TreeItem("global note", vscode.TreeItemCollapsibleState.None);
      item.description = exists ? "~/.config/aic/note.md" : "not created yet";
      item.iconPath = new vscode.ThemeIcon(exists ? "globe" : "circle-outline");
      item.command = { command: "aicNotes.openGlobalNote", title: "Open Global Note" };
      item.contextValue = "globalNote";
      return item;
    }
    if (element.kind === "root") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }
    if (element.kind === "bucket" || element.kind === "dir") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath =
        element.kind === "bucket" ? new vscode.ThemeIcon("archive") : vscode.ThemeIcon.Folder;
      return item;
    }
    // note
    const { level, visible } = await this._badge(element.uri);
    const kind = element.forcedLevel ? "file" : await targetKind(element.folder, element.relPath);
    const badge =
      element.forcedLevel ??
      level ??
      (kind === "folder" ? "folder-note" : kind === "file" ? "file-note" : undefined);
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = element.uri;
    item.description = [badge, kind === null && !element.forcedLevel ? "orphan" : null]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = !visible
      ? new vscode.ThemeIcon("lock")
      : kind === null && !element.forcedLevel
        ? new vscode.ThemeIcon("warning")
        : new vscode.ThemeIcon("note");
    item.tooltip = element.relPath;
    item.command = {
      command: "vscode.open",
      title: "Open Note",
      arguments: [element.uri],
    };
    item.contextValue = "note";
    return item;
  }
}
