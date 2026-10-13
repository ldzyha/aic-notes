import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { undo } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import {
  focusPageTarget,
  focusedPage,
  notePageCards,
  notePageHistory,
} from "../vendor/aic-editor-core/note-page-cards.js";
import { hostChange } from "../src/webview/host-changes.js";
import { minimalTextChange } from "../src/webview/secondary-draft.js";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {openNoteDocument, noteForCurrentFile} from "./src/notes/create.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js"; export {workspaceLinkUri} from "./src/notes/navigation.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

function harness(withOwnership = false) {
  const uri = (value) => ({
    scheme: "file",
    path: value,
    fsPath: value,
    toString: () => `file://${value}`,
  });
  const folder = { name: "workspace", uri: uri("/workspace") };
  // A second root: each workspace folder owns its own aic.md.
  const other = { name: "other", uri: uri("/other") };
  const folderOf = (resource) =>
    [folder, other].find(
      (entry) =>
        resource.path === entry.uri.path ||
        resource.path.startsWith(`${entry.uri.path}/`),
    );
  const commands = [];
  const registrations = new Map();
  const changes = new Set();
  const saveListeners = new Set();
  const willSaveListeners = new Set();
  const files = new Map([
    ["/workspace", { type: 2 }],
    ["/other", { type: 2 }],
  ]);
  const documents = new Map();
  const events = {
    opened: [],
    closed: [],
    writes: [],
    saved: [],
    errors: [],
    scans: [],
    reads: [],
    applied: [],
    external: [],
  };
  const tabGroups = {
    activeTabGroup: {},
    all: [],
    close: async (tab) => events.closed.push(tab),
    onDidChangeTabs: () => disposable(),
    onDidChangeTabGroups: () => disposable(),
  };
  const disposable = () => ({ dispose() {} });
  const addFile = (name, text = "note", type = 1, root = folder) => {
    const resource = uri(`${root.uri.path}/${name}`);
    files.set(resource.path, { text, type });
    return resource;
  };
  function getDocument(resource) {
    if (documents.has(resource.path)) return documents.get(resource.path);
    if (!files.has(resource.path)) throw new Error("missing document");
    let text = files.get(resource.path).text;
    const document = {
      uri: resource,
      isClosed: false,
      isDirty: false,
      version: 1,
      getText: () => text,
      positionAt: (offset) => offset,
      save: async () => {
        events.saved.push(resource.path);
        files.get(resource.path).text = text;
        document.isDirty = false;
        for (const listener of saveListeners) listener(document);
        return true;
      },
      replace: (from, to, insert) => {
        text = text.slice(0, from) + insert + text.slice(to);
        document.isDirty = true;
        document.version++;
        for (const notify of changes)
          notify({
            document,
            contentChanges: [
              { rangeOffset: from, rangeLength: to - from, text: insert },
            ],
          });
      },
    };
    documents.set(resource.path, document);
    return document;
  }
  const vscode = {
    RelativePattern: class {
      constructor(base, pattern) {
        this.base = base;
        this.pattern = pattern;
      }
    },
    Uri: {
      parse: (value) => ({ toString: () => value }),
      joinPath: (base, ...parts) =>
        uri(
          [base.path, ...parts]
            .join("/")
            .replace(/\/+/gu, "/")
            .replace(/\/$/u, ""),
        ),
    },
    FileType: { File: 1, Directory: 2 },
    TextDocumentSaveReason: { Manual: 1, AfterDelay: 2 },
    TextEdit: { replace: (range, text) => ({ range, text }) },
    Range: class {
      constructor(from, to) {
        this.from = from;
        this.to = to;
      }
    },
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    WorkspaceEdit: class {
      edits = [];
      creates = [];
      createFile(resource) {
        this.creates.push(resource);
      }
      insert(resource, _position, text) {
        this.edits.push({ resource, range: { from: 0, to: 0 }, text });
      }
      replace(resource, range, text) {
        this.edits.push({ resource, range, text });
      }
    },
    workspace: {
      get textDocuments() {
        return [...documents.values()];
      },
      workspaceFolders: [folder, other],
      getWorkspaceFolder: (resource) => folderOf(resource),
      asRelativePath: (resource) => {
        const root = folderOf(resource);
        return root
          ? resource.path.slice(root.uri.path.length).replace(/^\//u, "")
          : resource.path;
      },
      // The single-note model never scans the workspace for notes.
      findFiles: async (include) => {
        events.scans.push(include);
        return [];
      },
      fs: {
        readFile: async (resource) => {
          if (!files.has(resource.path)) throw new Error("missing");
          events.reads.push(resource.path);
          return new TextEncoder().encode(files.get(resource.path).text);
        },
        stat: async (resource) => {
          if (!files.has(resource.path)) throw new Error("missing");
          return { ...files.get(resource.path), ctime: 1 };
        },
        readDirectory: async (resource) =>
          [...files]
            .filter(
              ([name]) =>
                name.slice(0, name.lastIndexOf("/")) === resource.path,
            )
            .map(([name, file]) => [
              name.slice(name.lastIndexOf("/") + 1),
              file.type,
            ]),
        writeFile: async (resource, bytes) =>
          events.writes.push({ resource, bytes }),
      },
      openTextDocument: async (resource) => {
        events.opened.push(resource.path);
        return getDocument(resource);
      },
      applyEdit: async (edit) => {
        events.applied.push(edit);
        for (const resource of edit.creates ?? []) {
          if (files.has(resource.path)) return false;
          files.set(resource.path, { text: "", type: 1 });
        }
        for (const { resource, range, text } of edit.edits)
          getDocument(resource).replace(range.from, range.to, text);
        return true;
      },
      onDidChangeTextDocument: (listener) => {
        changes.add(listener);
        return { dispose: () => changes.delete(listener) };
      },
      onDidSaveTextDocument: (listener) => {
        saveListeners.add(listener);
        return { dispose: () => saveListeners.delete(listener) };
      },
      onWillSaveTextDocument: (listener) => {
        willSaveListeners.add(listener);
        return { dispose: () => willSaveListeners.delete(listener) };
      },
      onDidCloseTextDocument: () => disposable(),
      createFileSystemWatcher: () => ({
        dispose() {},
        onDidCreate: () => disposable(),
        onDidDelete: () => disposable(),
        onDidChange: () => disposable(),
      }),
    },
    commands: {
      executeCommand: async (...args) => {
        commands.push(args);
      },
    },
    env: {
      openExternal: async (target) => events.external.push(String(target)),
    },
    window: {
      tabGroups,
      onDidChangeActiveTextEditor: () => disposable(),
      registerWebviewViewProvider: () => disposable(),
      registerCustomEditorProvider: (id, provider) => {
        registrations.set(id, provider);
        return disposable();
      },
      showErrorMessage: (message) => events.errors.push(message),
      showWarningMessage: (message) => events.errors.push(message),
      setStatusBarMessage() {},
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => (name === "vscode" ? vscode : require(name)),
    crypto,
    TextEncoder,
    TextDecoder,
    URL,
    Buffer,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask() {},
  });
  const context = { extensionUri: uri("/extension"), subscriptions: [] };
  const ownership = withOwnership
    ? new module.exports.NoteEditOwnership()
    : undefined;
  const pane = new module.exports.SecondaryNotePane(context, ownership);
  const sent = [];
  pane.sendInit = async () => sent.push("init");
  pane.sendPaneState = async (status) => sent.push(status ?? "state");
  pane.focus = async (preserve) => sent.push({ focus: preserve });
  pane.view = {
    webview: {
      postMessage: async (message) => {
        sent.push(message);
        return true;
      },
    },
  };
  const panel = () => {
    const messages = [];
    const result = {
      active: true,
      disposed: false,
      dispose() {
        this.disposed = true;
      },
      onDidDispose: () => disposable(),
      webview: {
        cspSource: "test",
        asWebviewUri: (value) => value.toString(),
        postMessage: async (message) => {
          messages.push(message);
          result.onPost?.(message);
          return true;
        },
        onDidReceiveMessage: (listener) => {
          result.send = listener;
          return disposable();
        },
      },
      messages,
    };
    return result;
  };
  return {
    ...module.exports,
    vscode,
    context,
    uri,
    addFile,
    getDocument,
    folder,
    other,
    files,
    documents,
    pane,
    sent,
    commands,
    registrations,
    events,
    panel,
    ownership,
    willSaveListeners,
  };
}

test("workspace link boundaries reject escaping and scheme paths but preserve internal relative links", () => {
  const h = harness();
  const folder = h.vscode.workspace.workspaceFolders[0];
  for (const candidate of [
    "../outside.md",
    "nested/../../outside.md",
    "/outside.md",
    "C:/outside.md",
    "nested\\..\\outside.md",
    "https://example.com",
    "\u0000bad.md",
  ]) {
    assert.equal(h.workspaceLinkUri(folder, candidate), null, candidate);
  }
  assert.equal(
    h.workspaceLinkUri(folder, "nested/../inside.md")?.path,
    "/workspace/inside.md",
  );
  assert.equal(
    h.workspaceLinkUri(folder, "nested/child.md")?.path,
    "/workspace/nested/child.md",
  );
});

test("main and sidebar file-open messages cannot open a path outside their workspace", async () => {
  const h = harness();
  const folder = h.vscode.workspace.workspaceFolders[0];
  const source = h.addFile("source.md", "source");
  const provider = new h.MarkdownEditorProvider(h.context);
  let statCalls = 0;
  const stat = h.vscode.workspace.fs.stat;
  h.vscode.workspace.fs.stat = async (...args) => {
    statCalls++;
    return stat(...args);
  };
  await provider._routeBus(
    { topic: "file.open", payload: { path: "../outside.note.md" } },
    h.getDocument(source),
    folder,
    "source.md",
  );
  h.pane.folder = folder;
  await h.pane.routeBus({
    topic: "file.open",
    payload: { path: "../outside.note.md" },
  });
  assert.equal(statCalls, 0);
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.events.opened, []);
  provider.dispose();
  h.pane.dispose();
});

test("main wiki links may traverse to a sibling within the workspace, never outside it", async () => {
  const h = harness();
  const folder = h.vscode.workspace.workspaceFolders[0];
  const source = h.addFile("nested/source.note.md", "source");
  const target = h.addFile("target.note.md", "target");
  const provider = new h.MarkdownEditorProvider(h.context);
  await provider._routeBus(
    { topic: "wiki.open", payload: { target: "../../outside" } },
    h.getDocument(source),
    folder,
    "nested/source.note.md",
  );
  assert.deepEqual(h.commands, []);
  await provider._routeBus(
    { topic: "wiki.open", payload: { target: "../target" } },
    h.getDocument(source),
    folder,
    "nested/source.note.md",
  );
  assert.equal(h.commands.at(-1)?.[1]?.path, target.path);
  provider.dispose();
});

test("legacy note association resolves to the same main provider without disposing or redirecting", async () => {
  const h = harness();
  const provider = h.MarkdownEditorProvider.register(h.context);
  assert.equal(h.registrations.get("aicNotes.markdown"), provider);
  assert.equal(h.registrations.get("aicNotes.noteRedirect"), provider);
  for (const name of ["workspace.note.md", "docs.note.md", "aic.md"]) {
    const panel = h.panel();
    await provider.resolveCustomTextEditor(
      h.getDocument(h.addFile(name)),
      panel,
    );
    await panel.send({ type: "ready" });
    assert.equal(panel.disposed, false);
    assert.doesNotMatch(panel.webview.html, /id="document-source"/u);
    assert.equal(panel.messages[0].type, "init");
    assert.deepEqual(h.commands, []);
  }
  provider.dispose();
});

test("main-note edits stay in TextDocument until Ctrl+S", async () => {
  const h = harness();
  const resource = h.addFile("aic.md", "body");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({
    type: "edit",
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " changed" }],
  });
  assert.equal(document.getText(), "body changed");
  assert.equal(h.files.get(resource.path).text, "body");
  await panel.send({ type: "save" });
  assert.deepEqual(h.events.saved, [resource.path]);
  assert.equal(document.getText(), "body changed");
  assert.equal(
    panel.messages.filter((message) => message.type === "external").length,
    0,
  );
  assert.deepEqual(h.events.errors, []);
});

test("primary save sends a correlated success only after saving FIFO edits and reports failures", async () => {
  const h = harness();
  const resource = h.addFile("ordinary.md", "base");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  const edit = panel.send({
    type: "edit",
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " edited" }],
  });
  const save = panel.send({
    type: "save",
    generation: 0,
    relativePath: "ordinary.md",
    requestId: 1,
  });
  await Promise.all([edit, save]);
  const first = panel.messages.find(
    (message) => message.type === "primary.saved",
  );
  assert.equal(first.requestId, 1);
  assert.equal(first.relativePath, "ordinary.md");
  assert.equal(first.saved, true);
  assert.equal(first.text, "base edited");
  assert.equal(h.files.get(resource.path).text, first.text);
  document.save = async () => false;
  await panel.send({
    type: "save",
    generation: 0,
    relativePath: "ordinary.md",
    requestId: 2,
  });
  assert.equal(
    panel.messages.find((message) => message.requestId === 2).saved,
    false,
  );
  await panel.send({
    type: "save",
    generation: 99,
    relativePath: "ordinary.md",
    requestId: 3,
  });
  assert.equal(
    panel.messages.find((message) => message.requestId === 3).saved,
    false,
  );
  assert.deepEqual(h.events.saved, [resource.path]);
  provider.dispose();
});

test("primary does not acknowledge newer external text as saved while an older save completes", async () => {
  const h = harness();
  const resource = h.addFile("ordinary.md", "base");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  let entered, release;
  const saving = new Promise((resolve) => {
    entered = resolve;
  });
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  const originalSave = document.save;
  document.save = async () => {
    const saved = await originalSave();
    entered();
    await delayed;
    return saved;
  };
  const request = panel.send({
    type: "save",
    generation: 0,
    relativePath: "ordinary.md",
    requestId: 42,
  });
  await saving;
  document.replace(4, 4, " external later");
  release();
  await request;
  const reply = panel.messages.find(
    (message) => message.type === "primary.saved",
  );
  assert.equal(reply.requestId, 42);
  assert.equal(reply.saved, false);
  assert.equal(document.isDirty, true);
  assert.equal(h.files.get(resource.path).text, "base");
  provider.dispose();
});

test("a main edit notifies the sidebar without replacing its dirty draft; stale sidebar save is rejected", async () => {
  const h = harness();
  const resource = h.addFile("aic.md", "body");
  const document = h.getDocument(resource);
  h.pane.documentUri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  h.vscode.workspace.onDidChangeTextDocument((event) =>
    h.pane.onDocumentChanged(event),
  );
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({
    type: "edit",
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " main" }],
  });
  assert.equal(h.pane.draftDirty, true);
  assert.equal(h.pane.generation, 1);
  assert.equal(h.sent.includes("init"), false);
  const result = await h.pane.commitDraft("sidebar unsaved", 0, 1, "aic.md");
  assert.equal(result.action, "stale-draft");
  assert.equal(document.getText(), "body main");
  assert.equal(
    h.sent.find((message) => message?.type === "committed").saved,
    false,
  );
});

test("manifest retains main/legacy editors, one reveal command and no sidecar contributions", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    manifest.contributes.configurationDefaults["workbench.editorAssociations"][
      "*.note.md"
    ],
    "aicNotes.markdown",
  );
  assert.equal(
    manifest.contributes.customEditors.find(
      (entry) => entry.viewType === "aicNotes.noteRedirect",
    ).priority,
    "option",
  );
  assert.deepEqual(Object.keys(manifest.contributes.menus), ["editor/title"]);
  assert.deepEqual(
    manifest.contributes.menus["editor/title"].map((entry) => entry.command),
    ["aicNotes.noteForCurrentFile"],
  );
  assert.deepEqual(
    manifest.contributes.keybindings.map((entry) => entry.command),
    ["aicNotes.noteForCurrentFile"],
  );
  assert.doesNotMatch(
    JSON.stringify([
      manifest.contributes.menus,
      manifest.contributes.keybindings,
    ]),
    /\.md/u,
  );
  assert.equal(
    manifest.contributes.configurationDefaults["explorer.fileNesting.patterns"],
    undefined,
  );
  assert.equal(manifest.contributes.menus["view/item/context"], undefined);
  assert.equal(manifest.contributes.views.aicNotes, undefined);
});

test("dirty sidebar opens main read-only, rejects stale main edits, and unlocks main after explicit sidebar save", async () => {
  const h = harness(true);
  const resource = h.addFile("aic.md", "base");
  const document = h.getDocument(resource);
  h.pane.documentUri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  await h.ownership.activate(h.pane.editSurface);
  const sidebarLease = h.ownership.state(h.pane.editSurface).lease;
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: document.getText(),
        dirty: false,
      });
  };
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  assert.equal(
    panel.messages.find((message) => message.type === "init").readOnly,
    true,
  );
  await panel.send({
    type: "edit",
    lease: sidebarLease,
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " stale main" }],
  });
  assert.equal(document.getText(), "base");
  assert.ok(
    panel.messages.some((message) => message.type === "editingRejected"),
  );
  assert.equal(h.pane.draftDirty, true);
  const result = await h.pane.commitDraft(
    "sidebar edit",
    0,
    1,
    "aic.md",
    sidebarLease,
  );
  assert.equal(result.saved, true);
  await h.ownership.queue;
  assert.equal(h.ownership.state(h.pane.editSurface).readOnly, true);
  const access = panel.messages
    .filter((message) => message.type === "editingState")
    .at(-1);
  assert.equal(access.readOnly, false);
  const saved = document.getText();
  const stale = await h.pane.commitDraft(
    "stale queued sidebar edit",
    0,
    2,
    "aic.md",
    sidebarLease,
  );
  assert.equal(stale.action, "not-owner");
  assert.equal(document.getText(), saved);
});

test("dirty main cannot transfer ownership, and queued sidebar commits cannot mutate it", async () => {
  const h = harness(true);
  h.addFile("file.js");
  const resource = h.addFile("aic.md", "base");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  const initial = panel.messages.find((message) => message.type === "init");
  await panel.send({
    type: "edit",
    lease: initial.lease,
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " main" }],
  });
  h.pane.documentUri = resource;
  h.pane.document = document;
  assert.equal(await h.ownership.activate(h.pane.editSurface), false);
  const stale = await h.pane.commitDraft(
    "sidebar queued",
    0,
    1,
    "aic.md",
    initial.lease,
  );
  assert.equal(stale.action, "not-owner");
  assert.equal(document.getText(), "base main");
  assert.deepEqual(h.events.saved, []);
});

test("clean native Save preserves exact source and unlocks a waiting sidebar", async () => {
  const h = harness(true);
  const resource = h.addFile("aic.md", "base");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: document.getText(),
        dirty: false,
      });
  };
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  const lease = panel.messages.find((message) => message.type === "init").lease;
  await panel.send({
    type: "edit",
    lease,
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " main" }],
  });
  h.pane.documentUri = resource;
  h.pane.document = document;
  assert.equal(await h.ownership.activate(h.pane.editSurface), false);
  assert.equal(h.willSaveListeners.size, 0);
  assert.equal(document.getText(), "base main");
  assert.equal(document.isDirty, true);
  await document.save();
  await h.ownership.queue;
  assert.equal(h.ownership.state(h.pane.editSurface).readOnly, false);
  assert.equal(document.getText(), "base main");
  assert.equal(h.events.saved.length, 1);
});

test("native manual Save has no AIC metadata writer", async () => {
  const h = harness(true);
  const document = h.getDocument(h.addFile("aic.md", "base"));
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  assert.equal(h.willSaveListeners.size, 0);
  assert.equal(document.getText(), "base");
});

test("primary save rejects a deleted existing file without recreating it and retains its draft", async () => {
  const h = harness();
  const resource = h.addFile("deleted.md", "base");
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({
    type: "edit",
    generation: 0,
    changes: [{ from: 4, to: 4, insert: " recoverable" }],
  });
  h.files.delete(resource.path);
  await panel.send({
    type: "save",
    generation: 0,
    relativePath: "deleted.md",
    requestId: 123,
  });
  assert.equal(h.files.has(resource.path), false);
  assert.deepEqual(h.events.saved, []);
  assert.equal(document.getText(), "base recoverable");
  assert.equal(document.isDirty, true);
  assert.equal(
    panel.messages.find(
      (message) =>
        message.requestId === 123 && message.type === "primary.saved",
    ).saved,
    false,
  );
  assert.match(h.events.errors[0], /deleted.*draft remains/u);
});

test("secondary rejects saving a deleted existing note while preserving a new placeholder creation", async () => {
  const h = harness();
  const resource = h.addFile("aic.md", "base");
  const document = h.getDocument(resource);
  h.pane.documentUri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  h.files.delete(resource.path);
  const result = await h.pane.commitDraft(
    "recoverable draft",
    h.pane.generation,
    124,
    "aic.md",
  );
  assert.equal(result.action, "missing");
  assert.equal(h.files.has(resource.path), false);
  assert.deepEqual(h.events.writes, []);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.pane.draftDirty, true);
  assert.equal(
    h.sent.find((message) => message?.type === "committed").saved,
    false,
  );
  const fresh = harness();
  const target = fresh.uri("/workspace/aic.md");
  fresh.pane.placeholderUri = target;
  fresh.pane.placeholderText = "";
  fresh.pane.draftDirty = true;
  const created = await fresh.pane.commitDraft(
    "new authored note",
    fresh.pane.generation,
    125,
    "aic.md",
  );
  assert.equal(created.saved, true);
  assert.equal(fresh.files.get(target.path).text, "new authored note");
});

test("primary keeps genuine untitled document creation available", async () => {
  const h = harness();
  const resource = h.addFile("new.md", "new authored document");
  const document = h.getDocument(resource);
  document.isUntitled = true;
  h.files.delete(resource.path);
  document.save = async () => {
    h.files.set(resource.path, { text: document.getText(), type: 1 });
    return true;
  };
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({
    type: "save",
    generation: 0,
    relativePath: "new.md",
    requestId: 126,
  });
  assert.equal(
    panel.messages.find(
      (message) =>
        message.requestId === 126 && message.type === "primary.saved",
    ).saved,
    true,
  );
  assert.equal(h.files.get(resource.path).text, "new authored document");
});

test("secondary does not save a note deleted while its draft edit is applied", async () => {
  const h = harness();
  const resource = h.addFile("aic.md", "base");
  const document = h.getDocument(resource);
  h.pane.documentUri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  const apply = h.vscode.workspace.applyEdit;
  h.vscode.workspace.applyEdit = async (edit) => {
    const accepted = await apply(edit);
    h.files.delete(resource.path);
    return accepted;
  };
  const result = await h.pane.commitDraft(
    "recoverable changed draft",
    h.pane.generation,
    127,
    "aic.md",
  );
  assert.equal(result.action, "missing");
  assert.equal(h.files.has(resource.path), false);
  assert.deepEqual(h.events.saved, []);
  assert.equal(document.getText(), "recoverable changed draft");
  assert.equal(h.pane.draftDirty, true);
});

// ---------------------------------------------------------------------------
// One note per workspace folder: `<workspaceFolder>/aic.md`, one page per file.
// `live()` runs the real init/pane-state path and pairs the pane with a small
// stand-in for its webview: the shared page-cards extension on a bare
// EditorState, driven by the same host messages as src/webview/main.js.
// ---------------------------------------------------------------------------

function live({ ownership = false, readOnly = false } = {}) {
  const h = harness(ownership);
  delete h.pane.sendInit;
  delete h.pane.sendPaneState;
  h.pane.focus = async () => {};
  h.pane.ready = true;
  if (readOnly) h.vscode.workspace.fs.isWritableFileSystem = () => false;
  h.vscode.workspace.onDidChangeTextDocument((event) =>
    h.pane.onDocumentChanged(event),
  );
  const access = new Compartment();
  const client = {
    state: null,
    inits: 0,
    generation: 0,
    dirty: false,
    saveReply: true,
    requestId: 0,
    get text() {
      return client.state.doc.toString();
    },
    get page() {
      const page = focusedPage(client.state);
      // The last page's range runs to the end of the note: drop its line end.
      return (
        page && {
          ...page,
          text: client.text.slice(page.from, page.to).replace(/\n$/u, ""),
        }
      );
    },
  };
  const view = {
    get state() {
      return client.state;
    },
    dispatch(spec) {
      client.state = client.state.update(spec).state;
    },
  };
  // A user keystroke at the end of the visible page (or of the whole note).
  client.type = async (text) => {
    // EditorView.editable is what refuses input in the real webview.
    if (client.state.readOnly && client.page?.exists !== false) return false;
    const before = client.text;
    const page = client.page;
    const at = page ? page.from + page.text.length : client.state.doc.length;
    view.dispatch({ changes: { from: at, insert: text }, userEvent: "input" });
    if (client.text === before) return false;
    client.dirty = true;
    await h.pane.onMessage({
      type: "draft.state",
      dirty: true,
      relativePath: client.relativePath,
    });
    return true;
  };
  // The real Ctrl+Z of the pane (historyKeymap runs this command).
  client.undo = () => undo(view);
  client.save = async () => {
    const result = await h.pane.commitDraft(
      client.text,
      client.generation,
      ++client.requestId,
      client.relativePath,
      client.lease,
      h.pane.view,
      client.stale ? client.base : undefined,
    );
    if (result.saved) {
      client.dirty = false;
      await h.pane.onMessage({
        type: "draft.state",
        dirty: false,
        relativePath: client.relativePath,
      });
    }
    return result;
  };
  h.pane.view = {
    webview: {
      postMessage: async (message) => {
        h.sent.push(message);
        switch (message.type) {
          case "init":
            client.inits++;
            client.generation = message.generation;
            client.relativePath = message.relativePath;
            client.resourceUri = message.resourceUri;
            client.lease = message.lease;
            client.dirty = false;
            client.base = message.text;
            client.stale = false;
            client.state = EditorState.create({
              doc: message.text,
              extensions: [
                notePageCards(),
                notePageHistory(),
                access.of(EditorState.readOnly.of(Boolean(message.readOnly))),
              ],
            });
            focusPageTarget(view, message.focus ?? null);
            break;
          case "page.focus":
            focusPageTarget(view, message.target);
            break;
          case "editingState":
            if (client.state && message.relativePath === client.relativePath) {
              client.lease = message.lease ?? client.lease;
              view.dispatch({
                effects: access.reconfigure(
                  EditorState.readOnly.of(Boolean(message.readOnly)),
                ),
              });
            }
            break;
          case "external":
            // An unsaved draft is never replaced (src/webview/main.js): it
            // goes stale and its next save carries the text it was typed on.
            if (client.dirty) {
              client.stale = true;
              void h.pane.onMessage({ type: "draft.externalConflict" });
              break;
            }
            client.generation = message.generation;
            view.dispatch(hostChange(message.changes));
            client.base = client.text;
            break;
          case "committed": {
            client.generation = message.generation;
            if (!message.saved) break;
            // The host may have saved a rebased text: adopt it as host text.
            const change = minimalTextChange(client.text, message.text);
            if (change) view.dispatch(hostChange(change));
            client.base = message.text;
            client.stale = false;
            break;
          }
          case "editing.probe":
            queueMicrotask(() =>
              h.pane.onMessage({
                type: "editing.snapshot",
                requestId: message.requestId,
                text: client.text,
                dirty: client.dirty,
              }),
            );
            break;
          case "draft.saveRequest":
            queueMicrotask(async () => {
              const saved = client.saveReply && (await client.save()).saved;
              await h.pane.onMessage({
                type: "draft.saveResult",
                requestId: message.requestId,
                relativePath: message.relativePath,
                saved: Boolean(saved),
              });
            });
            break;
        }
        return true;
      },
    },
  };
  h.client = client;
  h.of = (type) => h.sent.filter((message) => message?.type === type);
  h.activate = (resource) => {
    h.vscode.window.tabGroups.activeTabGroup.activeTab = resource
      ? { input: { uri: resource } }
      : undefined;
    return h.pane.followActive();
  };
  h.untouched = () => {
    assert.deepEqual(h.events.writes, []);
    assert.deepEqual(h.events.saved, []);
    assert.deepEqual(h.events.applied, []);
    assert.deepEqual(h.events.scans, []);
    assert.deepEqual(h.events.reads, []);
  };
  return h;
}

test("following a file opens its page of the workspace note and writes nothing", async () => {
  const h = live();
  const a = h.addFile("src/a.js", "code");
  const note = h.addFile("aic.md", "# Project\n\n--- src/a.js\nabout a\n");
  assert.equal(await h.activate(a), true);
  const [init] = h.of("init");
  assert.equal(init.relativePath, "aic.md");
  assert.equal(init.resourceUri, note.toString());
  assert.equal(init.focus, "src/a.js");
  assert.equal(init.placeholder, false);
  assert.equal(init.text, "# Project\n\n--- src/a.js\nabout a\n");
  assert.deepEqual(
    { target: h.client.page.target, text: h.client.page.text, exists: true },
    { target: "src/a.js", text: "about a", exists: h.client.page.exists },
  );
  assert.equal(h.pane.view.title, "a.js");
  // Repeated tab events for the same file change nothing at all.
  const sent = h.sent.length;
  assert.equal(await h.activate(a), true);
  assert.equal(h.sent.length, sent);
  assert.deepEqual(h.events.opened, [note.path]);
  h.untouched();
});

test("switching files keeps the unsaved draft in the same document and only moves the focus", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const b = h.addFile("lib/b.js");
  const note = h.addFile("aic.md", "--- a.js\nabout a\n");
  await h.activate(a);
  assert.equal(await h.client.type(" more"), true);
  assert.equal(h.pane.draftDirty, true);
  assert.equal(await h.activate(b), true);
  assert.equal(h.client.inits, 1);
  assert.equal(h.of("init").length, 1);
  assert.deepEqual(
    { ...h.of("page.focus").at(-1) },
    {
      type: "page.focus",
      relativePath: "aic.md",
      target: "lib/b.js",
    },
  );
  assert.equal(h.pane.draftDirty, true);
  assert.equal(h.client.text, "--- a.js\nabout a more\n");
  assert.deepEqual(
    { target: h.client.page.target, exists: h.client.page.exists },
    { target: "lib/b.js", exists: false },
  );
  assert.equal(h.pane.view.title, "b.js");
  assert.equal(h.files.get(note.path).text, "--- a.js\nabout a\n");
  h.untouched();
  // Undo on B's card cannot reach the text typed on A's page.
  assert.equal(h.client.undo(), false);
  assert.equal(h.client.text, "--- a.js\nabout a more\n");
  // The next keystroke starts B's page; one save writes both pages.
  await h.client.type("about b");
  assert.equal(
    h.client.text,
    "--- a.js\nabout a more\n\n--- lib/b.js\nabout b",
  );
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, h.client.text);
  assert.deepEqual(h.events.saved, [note.path]);
  // Back to A: still the same document, focus only.
  await h.activate(a);
  assert.equal(h.client.inits, 1);
  assert.equal(h.client.page.text, "about a more");
});

test("without aic.md nothing is created until the first edit is saved", async () => {
  const h = live();
  const a = h.addFile("src/a.js");
  const b = h.addFile("b.js");
  await h.activate(a);
  await h.activate(b);
  await h.activate(a);
  const [init] = h.of("init");
  assert.deepEqual(
    [init.text, init.placeholder, init.focus, init.relativePath],
    ["", true, "src/a.js", "aic.md"],
  );
  assert.equal(h.client.inits, 1);
  assert.deepEqual(h.client.page, {
    target: "src/a.js",
    from: 0,
    to: 0,
    exists: false,
    text: "",
  });
  assert.equal(h.files.has("/workspace/aic.md"), false);
  assert.deepEqual(h.events.opened, []);
  h.untouched();
  // Saving the untouched empty card creates nothing either.
  assert.equal((await h.client.save()).action, "placeholder");
  assert.equal(h.files.has("/workspace/aic.md"), false);
  h.untouched();

  await h.client.type("first note");
  assert.equal(h.client.text, "--- src/a.js\nfirst note");
  assert.equal(h.files.has("/workspace/aic.md"), false);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get("/workspace/aic.md").text,
    "--- src/a.js\nfirst note",
  );
  assert.equal(h.events.applied.length, 1);
  assert.deepEqual(
    h.events.applied[0].creates.map((resource) => resource.path),
    ["/workspace/aic.md"],
  );
  assert.equal(h.pane.documentUri.path, "/workspace/aic.md");
  assert.equal(h.pane.placeholderUri, undefined);
});

test("a pre-existing aic.md is adopted as is and only appended to by the first edit", async () => {
  const h = live();
  const a = h.addFile("src/a.js");
  const original = "---\ntitle: mine\n---\n# Project\n\nintro\n";
  const note = h.addFile("aic.md", original);
  await h.activate(a);
  assert.equal(h.client.page.exists, false);
  assert.equal(h.client.text, original);
  h.untouched();
  await h.client.type("about a");
  assert.equal(h.client.text, `${original}\n--- src/a.js\nabout a`);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    `${original}\n--- src/a.js\nabout a`,
  );
  assert.deepEqual(h.events.applied[0].creates, []);
});

test("aic.md itself, a non-file tab, an outside file and no editor show the whole note unfocused", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const note = h.addFile("aic.md", "--- a.js\nabout a\n");
  await h.activate(note);
  assert.equal(h.of("init")[0].focus, null);
  assert.equal(h.client.page, null);
  assert.equal(h.pane.view.title, "aic.md");
  await h.activate(a);
  assert.equal(h.client.page.target, "a.js");
  for (const resource of [
    note,
    undefined,
    h.uri("/elsewhere/outside.js"),
    { scheme: "untitled", path: "Untitled-1", toString: () => "untitled:1" },
    h.uri("/workspace/AIC.md"),
  ]) {
    await h.activate(a);
    assert.equal(await h.activate(resource), true);
    assert.equal(h.client.page, null, String(resource));
    assert.equal(h.of("page.focus").at(-1).target, null);
  }
  assert.equal(h.client.inits, 1);
  // The note never becomes a page of itself.
  await h.activate(note);
  await h.client.type("\nfree text");
  assert.equal(h.client.text, "--- a.js\nabout a\n\nfree text");
  // A nested aic.md is an ordinary file with its own page.
  await h.activate(h.addFile("docs/aic.md"));
  assert.equal(h.client.page.target, "docs/aic.md");
  assert.deepEqual(h.events.saved, []);
});

test("no workspace folder shows nothing and the reveal command reports an outside file", async () => {
  const h = live();
  h.vscode.workspace.workspaceFolders = [];
  h.vscode.workspace.getWorkspaceFolder = () => undefined;
  const outside = h.uri("/elsewhere/outside.js");
  assert.equal(await h.activate(outside), false);
  assert.deepEqual(h.sent, []);
  await assert.rejects(
    h.noteForCurrentFile(h.pane),
    (error) => error.structured?.error === "notes_no_workspace",
  );
  const rooted = live();
  rooted.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: outside },
  };
  await assert.rejects(
    rooted.noteForCurrentFile(rooted.pane),
    (error) => error.structured?.error === "notes_outside_workspace",
  );
  rooted.untouched();
});

test("multi-root: each workspace folder has its own aic.md, chosen by the active file", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const x = h.addFile("pkg/x.js", "code", 1, h.other);
  const first = h.addFile("aic.md", "--- a.js\nfirst root\n");
  const second = h.addFile("aic.md", "--- pkg/x.js\nsecond root\n", 1, h.other);
  await h.activate(x);
  assert.equal(h.of("init").at(-1).resourceUri, second.toString());
  assert.equal(h.client.page.text, "second root");
  await h.activate(a);
  assert.equal(h.of("init").at(-1).resourceUri, first.toString());
  assert.equal(h.of("init").at(-1).relativePath, "aic.md");
  assert.equal(h.client.page.text, "first root");
  assert.equal(h.client.inits, 2);
  h.untouched();
  // An unsaved draft is saved to its own root before the other note is shown.
  await h.client.type("!");
  await h.activate(x);
  assert.equal(h.files.get(first.path).text, "--- a.js\nfirst root!\n");
  assert.equal(h.files.get(second.path).text, "--- pkg/x.js\nsecond root\n");
  assert.equal(h.client.page.text, "second root");
  // If that save fails the pane stays on the unsaved note.
  await h.client.type("?");
  h.client.saveReply = false;
  assert.equal(await h.activate(a), false);
  assert.equal(h.pane.documentUri.path, second.path);
  assert.equal(h.client.text, "--- pkg/x.js\nsecond root?\n");
  assert.equal(h.files.get(second.path).text, "--- pkg/x.js\nsecond root\n");
  assert.deepEqual(h.events.saved, [first.path]);
});

test("a read-only workspace shows the card and writes nothing", async () => {
  const h = live({ readOnly: true });
  const a = h.addFile("a.js");
  await h.activate(a);
  assert.deepEqual(
    [h.of("init")[0].readOnly, h.of("init")[0].placeholder],
    [true, true],
  );
  assert.equal(h.client.page.target, "a.js");
  assert.equal(await h.client.type("blocked"), false);
  assert.equal(h.client.text, "");
  await assert.rejects(
    h.pane.commitDraft("--- a.js\nforced", h.client.generation, 1, "aic.md"),
    /read-only/u,
  );
  assert.equal(h.files.has("/workspace/aic.md"), false);
  assert.equal(h.of("committed").at(-1).saved, false);
  h.untouched();

  const existing = live({ readOnly: true });
  const note = existing.addFile("aic.md", "--- a.js\nabout a\n");
  await existing.activate(existing.addFile("a.js"));
  assert.equal(existing.client.page.text, "about a");
  assert.equal(await existing.client.type("!"), false);
  assert.equal(existing.files.get(note.path).text, "--- a.js\nabout a\n");
  existing.untouched();
});

test("an external change to aic.md while a page is focused is applied and the focus kept", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const note = h.addFile("aic.md", "--- a.js\nabout a\n\n--- b.js\nabout b\n");
  await h.activate(a);
  const document = h.getDocument(note);
  // Another editor rewrites text before, inside and after the focused page.
  document.replace(0, 0, "# Title\n\n");
  document.replace(
    document.getText().indexOf("about a"),
    document.getText().indexOf("about a") + 7,
    "A changed",
  );
  document.replace(
    document.getText().length,
    document.getText().length,
    "tail\n",
  );
  assert.equal(h.of("external").length, 3);
  assert.equal(h.client.text, document.getText());
  assert.equal(
    h.client.text,
    "# Title\n\n--- a.js\nA changed\n\n--- b.js\nabout b\ntail\n",
  );
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["a.js", "A changed"],
  );
  assert.equal(h.client.inits, 1);
  assert.equal(h.client.generation, h.pane.generation);
  // Text another editor wrote is not an undo step of the pane.
  assert.equal(h.client.undo(), false);
  assert.equal(h.client.text, document.getText());
  await h.client.type("!");
  assert.equal(h.client.undo(), true);
  assert.equal(h.client.text, document.getText());
});

test("the note appearing or vanishing on disk swaps placeholder and file only for a clean pane", async () => {
  const h = live();
  const a = h.addFile("a.js");
  await h.activate(a);
  assert.equal(h.of("init").at(-1).placeholder, true);
  const note = h.addFile("aic.md", "--- a.js\nfrom git\n");
  await h.activate(a);
  assert.equal(h.of("init").at(-1).placeholder, false);
  assert.equal(h.client.page.text, "from git");
  h.files.delete(note.path);
  h.documents.delete(note.path);
  await h.activate(a);
  assert.deepEqual(
    [h.of("init").at(-1).placeholder, h.of("init").at(-1).text],
    [true, ""],
  );
  // A typed-in placeholder is never replaced by a file that appears later.
  await h.client.type("mine");
  h.addFile("aic.md", "theirs\n");
  const inits = h.client.inits;
  await h.activate(h.addFile("b.js"));
  assert.equal(h.client.inits, inits);
  assert.equal(h.client.text, "--- a.js\nmine");
  assert.equal(h.files.get(note.path).text, "theirs\n");
  assert.deepEqual(h.events.saved, []);
});

test("a typed-in placeholder is appended to the note that appeared on disk", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const b = h.addFile("lib/b.js");
  await h.activate(a);
  await h.client.type("mine  \n  a\t");
  await h.activate(b);
  await h.client.type("about b");
  const draft = "--- a.js\nmine  \n  a\t\n\n--- lib/b.js\nabout b";
  assert.equal(h.client.text, draft);
  const theirs = "---\ntitle: t\n---\n# Theirs\n\n--- c.js\nabout c";
  const note = h.addFile("aic.md", theirs);
  await h.activate(a);
  assert.equal(h.client.text, draft);
  assert.equal(h.pane.draftDirty, true);

  const result = await h.client.save();
  assert.equal(result.saved, true);
  const merged = `${theirs}\n\n${draft}`;
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(merged.startsWith(theirs), true);
  assert.equal(h.of("committed").at(-1).text, merged);
  assert.deepEqual(h.events.saved, [note.path]);
  assert.deepEqual(
    h.events.applied.flatMap(({ creates }) => creates),
    [],
  );
  // The pane now shows the real file: same editor, focus kept, draft clean.
  assert.equal(h.client.text, merged);
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["a.js", "mine  \n  a\t"],
  );
  assert.equal(h.pane.documentUri.path, note.path);
  assert.equal(h.pane.placeholderUri, undefined);
  assert.equal(h.pane.draftDirty, false);
  assert.equal(h.client.inits, 1);
  // Later saves are ordinary saves of that file.
  await h.client.type("!");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, merged.replace("a\t", "a\t!"));
});

for (const failure of ["apply", "save"]) {
  test(`a failed ${failure} of the appended placeholder never lets a retry replace the note`, async () => {
    const h = live();
    await h.activate(h.addFile("a.js"));
    await h.client.type("mine");
    const theirs = "theirs\n";
    const note = h.addFile("aic.md", theirs);
    const document = h.getDocument(note);
    const apply = h.vscode.workspace.applyEdit;
    const save = document.save;
    if (failure === "apply") h.vscode.workspace.applyEdit = async () => false;
    else document.save = async () => false;
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.equal((await h.client.save()).action, "save-failed");
      assert.equal(h.files.get(note.path).text, theirs);
      assert.equal(document.getText().startsWith(theirs), true);
      // Still a placeholder draft: a later save appends again, never replaces.
      assert.equal(h.pane.placeholderUri.path, note.path);
      assert.equal(h.pane.documentUri, undefined);
      assert.equal(h.client.text, "--- a.js\nmine");
      assert.equal(h.pane.draftDirty, true);
    }
    h.vscode.workspace.applyEdit = apply;
    document.save = save;
    assert.equal((await h.client.save()).saved, true);
    assert.equal(h.files.get(note.path).text, "theirs\n\n--- a.js\nmine");
    assert.equal(h.client.text, "theirs\n\n--- a.js\nmine");
    assert.equal(h.pane.documentUri.path, note.path);
  });
}

test("a placeholder draft that collides with the appeared note is kept and saved once resolved", async () => {
  const h = live();
  const a = h.addFile("a.js");
  await h.activate(a);
  await h.client.type("mine");
  const theirs = "intro\n\n--- a.js\nfrom git\n";
  const note = h.addFile("aic.md", theirs);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await h.client.save();
    assert.equal(result.action, "appeared");
    assert.equal(h.files.get(note.path).text, theirs);
    assert.equal(h.getDocument(note).getText(), theirs);
    assert.deepEqual(h.events.saved, []);
    assert.deepEqual(h.events.applied, []);
    assert.equal(h.of("committed").at(-1).saved, false);
    // The draft stays visible and editable in the pane.
    assert.equal(h.client.text, "--- a.js\nmine");
    assert.equal(h.pane.draftDirty, true);
    assert.equal(h.pane.placeholderUri.path, note.path);
    assert.equal(h.pane.documentUri, undefined);
  }
  assert.match(
    h.of("paneState").at(-1).status,
    /^Note appeared on disk with this page · draft kept/u,
  );
  // The user moves the other page out of the way; the next Ctrl+S lands.
  h.getDocument(note).replace(7, 15, "--- old-a.js");
  const resolved = "intro\n\n--- old-a.js\nfrom git\n";
  assert.equal(h.getDocument(note).getText(), resolved);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, `${resolved}\n--- a.js\nmine`);
  assert.equal(h.client.text, `${resolved}\n--- a.js\nmine`);

  // Whole-note text (no page) typed into a placeholder never merges.
  const w = live();
  await w.activate(undefined);
  await w.client.type("loose text");
  const other = w.addFile("aic.md", "theirs\n");
  assert.equal((await w.client.save()).action, "appeared");
  assert.equal(w.files.get(other.path).text, "theirs\n");
  assert.equal(w.client.text, "loose text");
  assert.equal(w.pane.draftDirty, true);
});

test("an external change on another page and the dirty page both survive the save byte-exact", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const base = "# T  \n\n--- a.js\nabout a\n\n--- b.js\nabout b\n";
  const note = h.addFile("aic.md", base);
  await h.activate(a);
  await h.client.type(" mine\t");
  const document = h.getDocument(note);
  // The main editor rewrites page B while page A is an unsaved draft here.
  const at = document.getText().indexOf("about b");
  document.replace(at, at + 7, "B theirs \u00e9  \n\nmore");
  const theirs = document.getText();
  assert.equal(h.of("external").length, 1);
  // The draft is not replaced and the pane says so.
  assert.equal(h.client.text, base.replace("about a", "about a mine\t"));
  assert.match(h.of("paneState").at(-1).status, /^File changed externally/u);
  assert.equal(h.pane.draftDirty, true);

  const result = await h.client.save();
  assert.equal(result.saved, true);
  const merged = theirs.replace("about a", "about a mine\t");
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(h.of("committed").at(-1).text, merged);
  assert.equal(h.client.text, merged);
  assert.equal(h.client.generation, h.pane.generation);
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["a.js", "about a mine\t"],
  );
  assert.equal(h.pane.draftDirty, false);

  // The same text changed in both places: nothing is written, the draft
  // stays, and the save lands once the other change is taken back.
  await h.client.type(" again");
  const mine = h.client.text;
  const before = document.getText();
  const page = before.indexOf("about a mine\t");
  document.replace(page, page + 13, "THEIRS");
  const conflicting = document.getText();
  const applied = h.events.applied.length;
  const refused = await h.client.save();
  assert.equal(refused.action, "stale-draft");
  assert.equal(document.getText(), conflicting);
  assert.equal(h.events.applied.length, applied);
  assert.equal(h.client.text, mine);
  assert.equal(h.pane.draftDirty, true);
  assert.match(
    h.of("paneState").at(-1).status,
    /^File changed externally in the same text · draft kept/u,
  );
  document.replace(page, page + 6, "about a mine\t");
  assert.equal(document.getText(), before);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, mine);
  assert.equal(h.client.text, mine);
});

test("the pane and the main tab of aic.md share one edit lease", async () => {
  const h = live({ ownership: true });
  const a = h.addFile("a.js");
  const note = h.addFile("aic.md", "--- a.js\nabout a\n");
  const readme = h.addFile("README.md", "plain");
  await h.activate(a);
  assert.equal(h.client.state.readOnly, false);
  await h.client.type("!");
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(h.getDocument(note), panel);
  await panel.send({ type: "ready" });
  const main = panel.messages.find((message) => message.type === "init");
  assert.equal(main.readOnly, true);
  await panel.send({
    type: "edit",
    lease: main.lease,
    generation: 0,
    changes: [{ from: 0, to: 0, insert: "clobber " }],
  });
  assert.equal(h.getDocument(note).getText(), "--- a.js\nabout a\n");
  assert.ok(
    panel.messages.some((message) => message.type === "editingRejected"),
  );
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, "--- a.js\nabout a!\n");
  await h.ownership.queue;
  assert.equal(
    panel.messages.filter((message) => message.type === "editingState").at(-1)
      .readOnly,
    false,
  );
  // An ordinary Markdown file, and a legacy sidecar, take no lease at all.
  for (const resource of [readme, h.addFile("a.note.md", "legacy")]) {
    const plain = h.panel();
    await provider.resolveCustomTextEditor(h.getDocument(resource), plain);
    await plain.send({ type: "ready" });
    const init = plain.messages.find((message) => message.type === "init");
    assert.deepEqual([init.readOnly, init.lease], [false, undefined]);
  }
  provider.dispose();
});

test("Open target opens the page's file and refuses paths that leave the workspace folder", async () => {
  const h = live();
  const a = h.addFile("src/a.js");
  h.addFile("src", "", 2);
  const note = h.addFile("aic.md", "--- src/a.js\nabout a\n");
  await h.activate(a);
  for (const target of ["src/a.js", "/src/a.js", "./src/a.js", "src\\a.js"]) {
    h.commands.length = 0;
    await h.pane.onMessage({ type: "page.openTarget", target });
    assert.deepEqual(
      h.commands.map(([command, resource]) => [command, resource.path]),
      [["vscode.open", a.path]],
      target,
    );
  }
  h.commands.length = 0;
  await h.pane.onMessage({ type: "page.openTarget", target: "src/" });
  assert.deepEqual(
    h.commands.map(([command, resource]) => [command, resource.path]),
    [["revealInExplorer", "/workspace/src"]],
  );
  await h.pane.onMessage({
    type: "page.openTarget",
    target: "https://example.com/docs?q=1",
  });
  assert.deepEqual(h.events.external, ["https://example.com/docs?q=1"]);
  assert.deepEqual(h.events.errors, []);

  h.commands.length = 0;
  const provider = new h.MarkdownEditorProvider(h.context);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(h.getDocument(note), panel);
  const refused = [
    "../outside.js",
    "src/../../outside.js",
    "..\\outside.js",
    "/../etc/passwd",
    "C:/Windows/system.ini",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "vscode://settings",
    "",
    "/",
    "src/missing.js",
  ];
  for (const target of refused) {
    await h.pane.onMessage({ type: "page.openTarget", target });
    await panel.send({ type: "page.openTarget", target });
  }
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.events.external, ["https://example.com/docs?q=1"]);
  assert.equal(h.events.errors.length, refused.length * 2);
  await panel.send({ type: "page.openTarget", target: "src/a.js" });
  assert.deepEqual(
    h.commands.map(([command, resource]) => [command, resource.path]),
    [["vscode.open", a.path]],
  );
  provider.dispose();
  h.untouched();
});

test("a workspace with legacy .note.md files is byte-identical after following files and saving a page", async () => {
  const h = live();
  const a = h.addFile("src/a.js", "code a");
  const b = h.addFile("src/b.ts", "code b");
  const legacy = h.addFile(
    "src/a.note.md",
    "---\naic: note\n---\nlegacy a  \n",
  );
  h.addFile("src/b.note.md", "legacy b");
  h.addFile("src.note.md", "legacy folder note");
  h.addFile("workspace.note.md", "legacy project note");
  h.addFile(".aic/templates/file-note.md", "# {{title}}\n");
  const note = h.addFile("aic.md", "existing\n");
  const before = new Map(
    [...h.files].map(([name, file]) => [name, JSON.stringify(file)]),
  );
  await h.activate(a);
  await h.activate(b);
  await h.activate(legacy);
  // A legacy sidecar is an ordinary file: it is not followed as a note.
  assert.equal(h.client.page.target, "src/a.note.md");
  assert.equal(h.client.text, "existing\n");
  await h.activate(b);
  await h.client.type("about b");
  assert.equal((await h.client.save()).saved, true);
  await h.activate(a);
  for (const [name, file] of before) {
    if (name === note.path) continue;
    assert.equal(JSON.stringify(h.files.get(name)), file, name);
  }
  assert.deepEqual([...h.files.keys()], [...before.keys()]);
  assert.equal(
    h.files.get(note.path).text,
    "existing\n\n--- src/b.ts\nabout b",
  );
  assert.deepEqual(h.events.saved, [note.path]);
  assert.deepEqual(h.events.opened, [note.path]);
  assert.deepEqual(h.events.writes, []);
  assert.deepEqual(h.events.scans, []);
  assert.deepEqual(h.events.reads, []);
  assert.equal(h.events.applied.length, 1);
  assert.deepEqual(
    h.events.applied[0].edits.map(({ resource }) => resource.path),
    [note.path],
  );
});
