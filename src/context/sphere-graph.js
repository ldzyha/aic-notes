import path from "node:path";
import { parser } from "@lezer/javascript";
import { notePathFor, folderNotePathFor } from "../notes/paths.js";
import { activeWindowResource } from "../secondary/model.js";

const PIN_KEY = "aicNotes.contextSphere.pinned.v1";
const MAX_NODES = 80;
const MAX_BYTES = 256 * 1024;
const jsParser = parser.configure({ dialect: "ts jsx" });
const scriptPath = /\.(?:[cm]?[jt]sx?)$/iu;
const excluded = /(?:^|\/)(?:node_modules|\.git|dist|build|out)(?:\/|$)/u;

// Static syntax only: never execute code or treat comments/string contents as imports.
export function importReferences(text) {
  const references = [];
  let partial = false;
  const tree = jsParser.parse(text);
  tree.iterate({ enter(node) {
    if (node.type.isError) partial = true;
    let literal;
    if (["ImportDeclaration", "ExportDeclaration", "DynamicImport"].includes(node.name)) {
      literal = node.node.getChild("String");
      if (node.name === "DynamicImport" && !literal) partial = true;
    } else if (node.name === "CallExpression") {
      const callee = node.node.firstChild;
      if (callee?.name !== "VariableName" || text.slice(callee.from, callee.to) !== "require") return;
      const args = node.node.getChild("ArgList");
      const value = args?.firstChild?.nextSibling;
      if (value?.name === "String" && value.nextSibling?.name === ")") literal = value;
      else partial = true;
    }
    if (!literal) return;
    const raw = text.slice(literal.from + 1, literal.to - 1);
    if (raw.includes("\\")) { partial = true; return; }
    const before = text.slice(0, literal.from);
    references.push({ specifier: raw, line: before.split("\n").length - 1,
      column: literal.from - before.lastIndexOf("\n") - 1 });
  }});
  return { references, partial };
}

/** Read-only workspace adapter. No note creation, file writes, shell or LSP execution. */
export class ContextSphereGraph {
  constructor(vscode, { state, onUpdate = () => {}, maxNodes = MAX_NODES } = {}) {
    this.vscode = vscode;
    this.state = state;
    this.onUpdate = onUpdate;
    this.maxNodes = Math.max(1, Math.min(MAX_NODES, maxNodes));
    const savedPins = state?.get(PIN_KEY, []);
    this.pinned = new Set((Array.isArray(savedPins) ? savedPins : [])
      .slice(0, MAX_NODES)
      .filter(id => typeof id === "string" && id.length <= 4096));
    this.snapshot = { nodes: [], edges: [], activeId: "", limited: false };
    this.uris = new Map();
    this.disposables = [];
    this.repositories = new Map();
    this.cache = new Map();
    this.documentIds = new WeakMap();
    this.documentSerial = 0;
    this.revision = 0;
    this.disposed = false;
  }

  valid(uri) {
    return uri && ["file", "vscode-remote"].includes(uri.scheme) &&
      !excluded.test(uri.path) && Boolean(this.vscode.workspace.getWorkspaceFolder(uri));
  }

  id(uri) {
    const id = uri.with ? uri.with({ fragment: "", query: "" }).toString() : uri.toString();
    return uri.scheme === "file" && process.platform === "win32" ? id.toLowerCase() : id;
  }

  resolve(id) {
    const uri = this.uris.get(id);
    return this.valid(uri) ? uri : undefined;
  }

  async pin(id, pinned) {
    if (!this.resolve(id) || typeof pinned !== "boolean") return;
    if (pinned && this.pinned.size < MAX_NODES) this.pinned.add(id);
    else if (!pinned) this.pinned.delete(id);
    await this.state?.update(PIN_KEY, [...this.pinned]);
    return this.refresh();
  }

  schedule() {
    clearTimeout(this.timer);
    if (!this.disposed) this.timer = setTimeout(() => { void this.refresh(); }, 150);
  }

  start() {
    if (this.started || this.disposed) return;
    this.started = true;
    const { window, workspace, extensions } = this.vscode;
    const listen = (owner, name, action) => {
      if (typeof owner?.[name] === "function") this.disposables.push(owner[name](action));
    };
    listen(window, "onDidChangeActiveTextEditor", () => this.schedule());
    listen(window.tabGroups, "onDidChangeTabs", () => this.schedule());
    listen(window.tabGroups, "onDidChangeTabGroups", () => this.schedule());
    listen(workspace, "onDidChangeWorkspaceFolders", () => this.schedule());
    listen(workspace, "onDidGrantWorkspaceTrust", () => { void this.connectGit(); });
    listen(extensions, "onDidChange", () => { void this.connectGit(); });
    listen(workspace, "onDidSaveTextDocument", () => this.schedule());
    listen(workspace, "onDidChangeTextDocument", () => this.reflectDirty());
    listen(workspace, "onDidCloseTextDocument", () => this.reflectDirty());
    const watcher = workspace.createFileSystemWatcher?.("**/*");
    if (watcher) {
      this.disposables.push(watcher);
      for (const name of ["onDidCreate", "onDidChange", "onDidDelete"]) {
        listen(watcher, name, uri => { if (this.valid(uri)) this.schedule(); });
      }
    }
    void this.connectGit();
    void this.refresh();
  }

  async connectGit() {
    if (this.disposed || this.git || this.connecting || this.vscode.workspace.isTrusted === false) return;
    this.connecting = true;
    try {
      const extension = this.vscode.extensions?.getExtension("vscode.git");
      const exports = extension && (extension.isActive ? extension.exports : await extension.activate());
      if (this.disposed || !exports?.getAPI) return;
      this.git = exports.getAPI(1);
      const add = repo => {
        if (this.repositories.has(repo)) return;
        this.repositories.set(repo, repo.state.onDidChange(() => this.schedule()));
        this.schedule();
      };
      for (const repo of this.git.repositories ?? []) add(repo);
      this.disposables.push(this.git.onDidOpenRepository(add), this.git.onDidCloseRepository(repo => {
        this.repositories.get(repo)?.dispose(); this.repositories.delete(repo); this.schedule();
      }));
    } catch { /* Git is optional; an empty workspace is not an error. */ }
    finally { this.connecting = false; }
  }

  reflectDirty() {
    if (this.disposed) return;
    const dirty = new Set((this.vscode.workspace.textDocuments ?? []).filter(d => d.isDirty).map(d => this.id(d.uri)));
    let changed = false;
    const nodes = this.snapshot.nodes.map(node => {
      if (node.dirty === dirty.has(node.id)) return node;
      changed = true;
      return { ...node, dirty: dirty.has(node.id) };
    });
    // Typing updates badges only: it cannot rotate, re-index or change note text.
    if (changed) { this.snapshot = { ...this.snapshot, nodes }; this.onUpdate(this.snapshot); }
  }

  async refresh() {
    if (this.disposed) return;
    const revision = ++this.revision;
    const { workspace, window, Uri } = this.vscode;
    const nodes = new Map(), uris = new Map(), edges = new Map();
    let limited = false;
    const stale = () => this.disposed || revision !== this.revision;
    const docs = new Map((workspace.textDocuments ?? []).map(doc => [this.id(doc.uri), doc]));
    const add = (uri, flags = {}) => {
      if (!this.valid(uri)) return;
      const id = this.id(uri);
      if (!nodes.has(id)) {
        if (nodes.size >= this.maxNodes) { limited = true; return; }
        const folder = workspace.getWorkspaceFolder(uri);
        const relative = path.posix.relative(folder.uri.path, uri.path);
        nodes.set(id, { id, label: path.posix.basename(uri.path),
          path: `${folder.name}/${relative}`, kind: /\.note\.md$/iu.test(uri.path) ? "note" : "file",
          open: false, changed: false, dirty: Boolean(docs.get(id)?.isDirty),
          pinned: this.pinned.has(id), provisional: true, analysis: "unavailable" });
        uris.set(id, uri);
      }
      Object.assign(nodes.get(id), flags);
      return id;
    };
    const active = activeWindowResource(window);
    const activeId = add(active) ?? "";
    for (const id of this.pinned) {
      try { add(Uri.parse(id), { provisional: false }); } catch { /* Ignore stale state. */ }
    }
    for (const group of window.tabGroups?.all ?? []) for (const tab of group.tabs ?? []) {
      add(tab.input?.uri ?? tab.input?.modified, { open: true, provisional: false });
    }
    if (!window.tabGroups?.all && activeId) Object.assign(nodes.get(activeId), { open: true, provisional: false });
    for (const repo of this.git?.repositories ?? []) {
      for (const change of [...repo.state.indexChanges, ...repo.state.workingTreeChanges, ...repo.state.mergeChanges]) {
        add(change.uri, { changed: true, provisional: false });
      }
    }
    for (const doc of docs.values()) if (doc.isDirty) add(doc.uri, { dirty: true, provisional: false });

    const isFile = async uri => {
      if (stale() || !this.valid(uri)) return false;
      try { return Boolean((await workspace.fs.stat(uri)).type & 1); } catch { return false; }
    };
    const link = (from, to, kind, label, location) => {
      if (!from || !to || from === to) return;
      const id = `${kind}:${from}:${to}`;
      if (!edges.has(id)) edges.set(id, { id, from, to, kind, label, location });
    };
    const seeds = [...nodes.keys()];
    try {
      // Bounded one-hop exploration, not a workspace crawl. Neighbors remain provisional.
      for (const id of seeds) {
        if (stale()) return;
        const uri = uris.get(id), node = nodes.get(id);
        if (scriptPath.test(uri.path)) {
          try {
            const doc = docs.get(id);
            const stat = await workspace.fs.stat(uri);
            if (stale()) return;
            if (doc && !this.documentIds.has(doc)) this.documentIds.set(doc, ++this.documentSerial);
            const stamp = doc ? `doc:${this.documentIds.get(doc)}:${doc.version}` : `${stat.mtime}:${stat.size}`;
            let parsed = this.cache.get(id);
            if (!parsed || parsed.stamp !== stamp) {
              if (stat.size > MAX_BYTES) throw new Error("bounded source");
              const text = doc ? doc.getText() : new TextDecoder().decode(await workspace.fs.readFile(uri));
              if (stale()) return;
              if (text.length > MAX_BYTES) throw new Error("bounded source");
              parsed = { ...importReferences(text), stamp };
              this.cache.set(id, parsed);
            }
            node.analysis = parsed.partial ? "partial" : "ready";
            for (const ref of parsed.references.slice(0, 100)) {
              if (stale()) return;
              if (!ref.specifier.startsWith("./") && !ref.specifier.startsWith("../")) {
                node.analysis = "partial"; continue;
              }
              const base = Uri.joinPath(uri, "..", ref.specifier);
              const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js"]
                .map(suffix => base.with({ path: base.path + suffix }))];
              if (/\.js$/u.test(base.path)) candidates.push(base.with({ path: base.path.replace(/\.js$/u, ".ts") }));
              let found;
              for (const candidate of candidates) { if (await isFile(candidate)) { found = candidate; break; } }
              if (found) {
                const to = add(found);
                if (!to) node.analysis = "partial";
                link(id, to, "import", ref.specifier, { uri: id, line: ref.line, column: ref.column });
              } else node.analysis = "partial";
            }
            if (parsed.references.length > 100) { limited = true; node.analysis = "partial"; }
          } catch { node.analysis = "unavailable"; }
        }
        if (node.kind === "note") continue;
        const folder = workspace.getWorkspaceFolder(uri);
        const relative = path.posix.relative(folder.uri.path, uri.path);
        const parts = relative.split("/").slice(0, -1);
        const notes = [notePathFor(relative), `${folder.name}.note.md`,
          ...parts.map((_, index) => folderNotePathFor(parts.slice(0, index + 1).join("/")))];
        for (const notePath of new Set(notes.filter(Boolean))) {
          const note = Uri.joinPath(folder.uri, notePath);
          if (await isFile(note)) link(id, add(note), "note", "Note context");
        }
      }
      if (stale()) return;
      // Removed nodes cannot remain usable as arbitrary file-opening capabilities.
      this.uris = uris;
      for (const key of this.cache.keys()) if (!nodes.has(key)) this.cache.delete(key);
      this.snapshot = { nodes: [...nodes.values()], edges: [...edges.values()], activeId, limited };
      this.onUpdate(this.snapshot);
      return this.snapshot;
    } catch {
      // Read failures retain the previous graph. No notification storm while navigating.
      return this.snapshot;
    }
  }

  dispose() {
    this.disposed = true;
    this.revision++;
    clearTimeout(this.timer);
    for (const disposable of [...this.disposables, ...this.repositories.values()]) disposable?.dispose();
    this.disposables = [];
    this.repositories.clear();
    this.cache.clear();
    this.uris.clear();
  }
}
