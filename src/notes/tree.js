// The project Markdown explorer. It includes every *.md document while keeping
// *.note.md sidecars visibly distinct and attached to their target semantics.
// Shape per workspace folder:
//   project note (<rootName>.note.md at root)
//   .aic/notes/ bucket ("project globals")
//   directory hierarchy of the remaining Markdown files
// Note metadata comes from frontmatter (lazy 1 KB read, mtime-cached);
// agent-hidden notes get a lock icon; a note whose target is gone is an orphan.

import * as vscode from "vscode";
import * as path from "node:path";
import { noteTargetStem } from "./paths.js";
import { parseFrontmatter, isAgentVisible } from "./frontmatter.js";
import { targetKind } from "./target.js";
import { isNotePath } from "../secondary/model.js";

const EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**,**/.*/**}";

// one tree element; kind: root | projectPlaceholder | bucket | dir | note | document
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
    this._watcher = vscode.workspace.createFileSystemWatcher("**/*.md");
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

  async _markdownFor(folder) {
    const rel = (p) => new vscode.RelativePattern(folder, p);
    const [main, bucket] = await Promise.all([
      vscode.workspace.findFiles(rel("**/*.md"), rel(EXCLUDE)),
      vscode.workspace.findFiles(rel(".aic/notes/*.note.md")),
    ]);
    const seen = new Map();
    for (const uri of [...main, ...bucket]) {
      seen.set(
        uri.fsPath,
        vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/"),
      );
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
    let level,
      visible = true;
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
      const roots = [];
      if (folders.length === 1) return this._folderChildren(folders[0]);
      for (const f of folders)
        roots.push(new Item("root", f.name, { folder: f }));
      return roots;
    }
    if (element.kind === "root") return this._folderChildren(element.folder);
    if (element.kind === "bucket" || element.kind === "dir")
      return element.children;
    return [];
  }

  async _folderChildren(folder) {
    const notes = await this._markdownFor(folder);
    const projectNoteRel = `${folder.name}.note.md`;
    const items = [];
    let hasProjectNote = false;
    const bucket = [];
    const byDir = new Map(); // top-level dir → notes under it

    for (const n of notes) {
      if (n.relPath === projectNoteRel) {
        hasProjectNote = true;
        items.push(
          new Item("note", "Project note", {
            uri: n.uri,
            relPath: n.relPath,
            folder,
            forcedLevel: "project",
            projectName: folder.name,
          }),
        );
      } else if (n.relPath.startsWith(".aic/notes/")) {
        bucket.push(
          new Item("note", path.basename(n.relPath), {
            uri: n.uri,
            relPath: n.relPath,
            folder,
            forcedLevel: "global",
          }),
        );
      } else {
        const top = n.relPath.includes("/")
          ? n.relPath.slice(0, n.relPath.indexOf("/"))
          : "";
        if (!byDir.has(top)) byDir.set(top, []);
        byDir.get(top).push(n);
      }
    }
    if (!hasProjectNote) {
      items.unshift(new Item("projectPlaceholder", "Project note", { folder }));
    }
    if (bucket.length)
      items.push(
        new Item("bucket", "project globals (.aic/notes)", {
          children: bucket,
        }),
      );

    const rootNotes = byDir.get("") ?? [];
    byDir.delete("");
    for (const [dir, dirNotes] of [...byDir.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      items.push(
        new Item("dir", dir, {
          children: dirNotes.map(
            (n) =>
              new Item(
                isNotePath(n.relPath) ? "note" : "document",
                this._entryLabel(n.relPath),
                {
                  uri: n.uri,
                  relPath: n.relPath,
                  folder,
                },
              ),
          ),
        }),
      );
    }
    for (const n of rootNotes) {
      items.push(
        new Item(
          isNotePath(n.relPath) ? "note" : "document",
          this._entryLabel(n.relPath),
          {
            uri: n.uri,
            relPath: n.relPath,
            folder,
          },
        ),
      );
    }
    return items;
  }

  _entryLabel(relPath) {
    if (!isNotePath(relPath)) return path.basename(relPath);
    const t = noteTargetStem(relPath);
    return t
      ? t.stem.slice(t.stem.lastIndexOf("/") + 1)
      : path.basename(relPath);
  }

  async getTreeItem(element) {
    if (element.kind === "root") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = vscode.ThemeIcon.Folder;
      return item;
    }
    if (element.kind === "projectPlaceholder") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.description = `${element.folder.name} · create on first save`;
      item.iconPath = new vscode.ThemeIcon("circle-outline");
      item.command = {
        command: "aicNotes.openProjectNote",
        title: "Open Project Note",
        arguments: [element.folder.uri],
      };
      item.contextValue = "projectPlaceholder";
      return item;
    }
    if (element.kind === "bucket" || element.kind === "dir") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath =
        element.kind === "bucket"
          ? new vscode.ThemeIcon("archive")
          : vscode.ThemeIcon.Folder;
      item.contextValue = element.kind; // "dir" | "bucket" — enables group delete
      return item;
    }
    if (element.kind === "document") {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.resourceUri = element.uri;
      item.description = "Document";
      item.iconPath = new vscode.ThemeIcon("markdown");
      item.tooltip = element.relPath;
      item.command = {
        command: "aicNotes.openNote",
        title: "Open Document",
        arguments: [element.uri],
      };
      item.contextValue = "document";
      return item;
    }
    // note
    const { level, visible } = await this._badge(element.uri);
    const kind = element.forcedLevel
      ? "file"
      : await targetKind(element.folder, element.relPath);
    // "orphan" (warn icon) only when the note CLAIMS a target via its level
    // and that target is gone. A free-standing note (ticket/topic notes have
    // no frontmatter, or a non file/folder level) is legitimate — plain icon
    // (owner 2026-07-06: ts-* ticket notes wrongly warned).
    const claimsTarget = level === "file-note" || level === "folder-note";
    const orphan = kind === null && !element.forcedLevel && claimsTarget;
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.resourceUri = element.uri;
    item.description = [
      element.forcedLevel === "project" ? element.projectName : "Note",
      orphan ? "orphan" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    item.iconPath = !visible
      ? new vscode.ThemeIcon("lock")
      : orphan
        ? new vscode.ThemeIcon("warning")
        : new vscode.ThemeIcon("note");
    item.tooltip = element.relPath;
    item.command = {
      command: "aicNotes.openInSecondary",
      title: "Open Note",
      arguments: [element.uri, { reveal: true }],
    };
    item.contextValue = "note";
    return item;
  }
}
