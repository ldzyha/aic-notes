import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
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
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {openNoteDocument, noteForCurrentFile, changeNoteFile} from "./src/notes/create.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js"; export {workspaceLinkUri, pageTargetUri} from "./src/notes/navigation.js"; export {NoteFileChoice, pageTarget} from "./src/notes/note-file.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

// Each harness gets its own folder standing in for `$XDG_CONFIG_HOME/aic`.
const configRoot = mkdtempSync(join(tmpdir(), "aic-notes-routing-"));
test.after(() => rmSync(configRoot, { recursive: true, force: true }));
let configCount = 0;

function harness(withOwnership = false) {
  const uri = (value) => ({
    scheme: "file",
    path: value,
    fsPath: value,
    with: (change) => uri(change.path ?? value),
    toString: () => `file://${value}`,
  });
  const configDir = join(configRoot, String(++configCount), "aic");
  const configFile = join(configDir, "note-file.json");
  const folder = { name: "workspace", uri: uri("/workspace") };
  const folderOf = (resource) =>
    [folder].find(
      (entry) =>
        resource.path === entry.uri.path ||
        resource.path.startsWith(`${entry.uri.path}/`),
    );
  const commands = [];
  const registrations = new Map();
  const changes = new Set();
  const saveListeners = new Set();
  const willSaveListeners = new Set();
  const files = new Map([["/workspace", { type: 2 }]]);
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
      parse: (value) =>
        value.startsWith("file:///")
          ? uri(value.slice("file://".length))
          : { scheme: value.split(":")[0], toString: () => value },
      file: (value) => uri(value),
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
      workspaceFolders: [folder],
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
    process,
  });
  const context = { extensionUri: uri("/extension"), subscriptions: [] };
  const ownership = withOwnership
    ? new module.exports.NoteEditOwnership()
    : undefined;
  const state = new Map();
  const globalState = {
    get: (key) => state.get(key),
    update: async (key, value) =>
      value === undefined ? state.delete(key) : state.set(key, value),
  };
  const choice = new module.exports.NoteFileChoice({ globalState, configDir });
  // What the aic code editor writes when the user picks the note file there.
  const chooseInCodeEditor = (path) => {
    rmSync(configDir, { recursive: true, force: true });
    if (path === null) return;
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      configFile,
      `${JSON.stringify({ schemaVersion: 1, path }, null, 2)}\n`,
    );
  };
  const pane = new module.exports.SecondaryNotePane(context, ownership, choice);
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
    choice,
    state,
    configDir,
    configFile,
    chooseInCodeEditor,
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

test("main and sidebar file-open messages cannot open a path outside their folder", async () => {
  const h = harness();
  const folder = h.vscode.workspace.workspaceFolders[0];
  const source = h.addFile("source.md", "source");
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  // Relative links of the note stay inside the note file's folder.
  h.pane.documentUri = h.uri("/workspace/aic.md");
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  h.choice.uri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  h.vscode.workspace.onDidChangeTextDocument((event) =>
    h.pane.onDocumentChanged(event),
  );
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  h.choice.uri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  await h.ownership.activate(h.pane.editSurface);
  const sidebarLease = h.ownership.state(h.pane.editSurface).lease;
  const provider = new h.MarkdownEditorProvider(
    h.context,
    h.ownership,
    h.choice,
  );
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
  h.choice.uri = resource;
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(
    h.context,
    h.ownership,
    h.choice,
  );
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
  h.choice.uri = resource;
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
  h.choice.uri = resource;
  const document = h.getDocument(resource);
  const provider = new h.MarkdownEditorProvider(
    h.context,
    h.ownership,
    h.choice,
  );
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
  h.choice.uri = resource;
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
  const provider = new h.MarkdownEditorProvider(
    h.context,
    h.ownership,
    h.choice,
  );
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  h.choice.uri = resource;
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
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
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
  h.choice.uri = resource;
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

function live({
  ownership = false,
  readOnly = false,
  noteFile = "/workspace/aic.md",
} = {}) {
  const h = harness(ownership);
  // The note file was chosen before (here or in the code editor).
  h.chooseInCodeEditor(noteFile);
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
  // A user edit anywhere in the shown text (whole-note view).
  client.replace = async (from, to, insert) => {
    view.dispatch({ changes: { from, to, insert }, userEvent: "input" });
    client.dirty = true;
    await h.pane.onMessage({
      type: "draft.state",
      dirty: true,
      relativePath: client.relativePath,
    });
  };
  // The footer's Discard my changes and reload button.
  client.discard = () =>
    h.pane.onMessage({
      type: "draft.discard",
      relativePath: client.relativePath,
    });
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
            client.focus = message.focus ?? null;
            focusPageTarget(view, client.focus);
            break;
          case "page.focus":
            client.focus = message.target ?? null;
            focusPageTarget(view, client.focus);
            break;
          case "reset":
            // src/webview/main.js: the draft is dropped for the host text.
            client.generation = message.generation;
            view.dispatch(
              hostChange({
                from: 0,
                to: client.state.doc.length,
                insert: message.text,
              }),
            );
            if ((focusedPage(client.state)?.target ?? null) !== client.focus)
              focusPageTarget(view, client.focus);
            client.dirty = false;
            client.base = message.text;
            client.stale = false;
            void h.pane.onMessage({
              type: "draft.state",
              dirty: false,
              relativePath: client.relativePath,
            });
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

test("following a file opens its page of the note file and writes nothing", async () => {
  const h = live();
  const a = h.addFile("src/a.js", "code");
  const note = h.addFile(
    "aic.md",
    "# Project\n\n--- /workspace/src/a.js\nabout a\n",
  );
  assert.equal(await h.activate(a), true);
  const [init] = h.of("init");
  assert.equal(init.relativePath, "aic.md");
  assert.equal(init.resourceUri, note.toString());
  assert.equal(init.focus, "/workspace/src/a.js");
  assert.equal(init.placeholder, false);
  assert.equal(init.text, "# Project\n\n--- /workspace/src/a.js\nabout a\n");
  assert.deepEqual(
    { target: h.client.page.target, text: h.client.page.text, exists: true },
    {
      target: "/workspace/src/a.js",
      text: "about a",
      exists: h.client.page.exists,
    },
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
  const note = h.addFile("aic.md", "--- /workspace/a.js\nabout a\n");
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
      target: "/workspace/lib/b.js",
    },
  );
  assert.equal(h.pane.draftDirty, true);
  assert.equal(h.client.text, "--- /workspace/a.js\nabout a more\n");
  assert.deepEqual(
    { target: h.client.page.target, exists: h.client.page.exists },
    { target: "/workspace/lib/b.js", exists: false },
  );
  assert.equal(h.pane.view.title, "b.js");
  assert.equal(h.files.get(note.path).text, "--- /workspace/a.js\nabout a\n");
  h.untouched();
  // Undo on B's card cannot reach the text typed on A's page.
  assert.equal(h.client.undo(), false);
  assert.equal(h.client.text, "--- /workspace/a.js\nabout a more\n");
  // The next keystroke starts B's page; one save writes both pages.
  await h.client.type("about b");
  assert.equal(
    h.client.text,
    "--- /workspace/a.js\nabout a more\n\n--- /workspace/lib/b.js\nabout b",
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
    ["", true, "/workspace/src/a.js", "aic.md"],
  );
  assert.equal(h.client.inits, 1);
  assert.deepEqual(h.client.page, {
    target: "/workspace/src/a.js",
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
  assert.equal(h.client.text, "--- /workspace/src/a.js\nfirst note");
  assert.equal(h.files.has("/workspace/aic.md"), false);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get("/workspace/aic.md").text,
    "--- /workspace/src/a.js\nfirst note",
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
  assert.equal(h.client.text, `${original}\n--- /workspace/src/a.js\nabout a`);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    `${original}\n--- /workspace/src/a.js\nabout a`,
  );
  assert.deepEqual(h.events.applied[0].creates, []);
});

test("the note file itself, a non-file tab and no editor show the whole note unfocused; every other file has its own page", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const note = h.addFile("aic.md", "--- /workspace/a.js\nabout a\n");
  await h.activate(note);
  assert.equal(h.of("init")[0].focus, null);
  assert.equal(h.client.page, null);
  assert.equal(h.pane.view.title, "aic.md");
  await h.activate(a);
  assert.equal(h.client.page.target, "/workspace/a.js");
  for (const resource of [
    note,
    undefined,
    { scheme: "untitled", path: "Untitled-1", toString: () => "untitled:1" },
    { scheme: "output", path: "log", toString: () => "output:log" },
    // Paths match without regard to case, so this is the note too.
    h.uri("/workspace/AIC.md"),
  ]) {
    await h.activate(a);
    assert.equal(await h.activate(resource), true);
    assert.equal(h.client.page, null, String(resource));
    assert.equal(h.of("page.focus").at(-1).target, null);
  }
  assert.equal(h.client.inits, 1);
  // A file outside every workspace folder has a page too, by its full path.
  await h.activate(h.uri("/elsewhere/outside.js"));
  assert.equal(h.client.page.target, "/elsewhere/outside.js");
  // The note never becomes a page of itself.
  await h.activate(note);
  await h.client.type("\nfree text");
  assert.equal(h.client.text, "--- /workspace/a.js\nabout a\n\nfree text");
  // Another aic.md is an ordinary file with its own page.
  await h.activate(h.addFile("docs/aic.md"));
  assert.equal(h.client.page.target, "/workspace/docs/aic.md");
  assert.deepEqual(h.events.saved, []);
});

test("without a note file the pane offers only Choose your note file; choosing writes the shared choice and creates nothing", async () => {
  const h = live({ noteFile: null });
  // No folder is needed: the note file is not part of a workspace.
  h.vscode.workspace.workspaceFolders = [];
  h.vscode.workspace.getWorkspaceFolder = () => undefined;
  const a = h.uri("/elsewhere/a.js");
  assert.equal(await h.activate(a), false);
  assert.deepEqual(
    [h.of("paneState").at(-1).hasSurface, h.of("paneState").at(-1).problem],
    [false, ""],
  );
  assert.deepEqual(h.of("init"), []);
  const asked = [];
  let pick = 1;
  h.vscode.window.showQuickPick = async (items, options) => {
    asked.push(options.title);
    return items[pick];
  };
  h.vscode.window.showSaveDialog = async (options) => {
    asked.push(options.defaultUri.path.split("/").at(-1));
    return h.uri("/home/me/notes/aic.md");
  };
  h.vscode.window.showOpenDialog = async () => [h.uri("/home/me/old.md")];
  // Dismissed: nothing is stored and the command reports nothing.
  pick = 9;
  await h.noteForCurrentFile(h.pane);
  assert.equal(existsSync(h.configFile), false);
  assert.deepEqual(h.events.errors, []);

  pick = 1;
  await h.pane.onMessage({ type: "note.choose" });
  assert.deepEqual(asked, [
    "Choose your note file",
    "Choose your note file",
    "aic.md",
  ]);
  // The same file and format the aic code editor reads, private to the user.
  assert.equal(
    readFileSync(h.configFile, "utf8"),
    '{\n  "schemaVersion": 1,\n  "path": "/home/me/notes/aic.md"\n}\n',
  );
  assert.equal(statSync(h.configFile).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(h.configDir), ["note-file.json"]);
  assert.equal(h.state.size, 0);
  const [init] = h.of("init");
  assert.deepEqual(
    [init.placeholder, init.focus, init.resourceUri],
    [true, "/elsewhere/a.js", "file:///home/me/notes/aic.md"],
  );
  assert.equal(h.files.has("/home/me/notes/aic.md"), false);
  h.untouched();
  await h.client.type("about a");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get("/home/me/notes/aic.md").text,
    "--- /elsewhere/a.js\nabout a",
  );
  // Relaunch: a new session reads the same choice and asks nothing.
  const relaunched = new h.NoteFileChoice({ configDir: h.configDir });
  assert.equal((await relaunched.read()).path, "/home/me/notes/aic.md");

  // Change Note File: an existing file this time.
  pick = 0;
  await h.changeNoteFile(h.pane);
  assert.match(
    readFileSync(h.configFile, "utf8"),
    /"path": "\/home\/me\/old\.md"/u,
  );
  assert.equal(statSync(h.configFile).mode & 0o777, 0o600);
  assert.equal(h.pane.placeholderUri.path, "/home/me/old.md");
});

test("the shared choice lives in $XDG_CONFIG_HOME/aic, else ~/.config/aic; a host without Node keeps it in globalState", async () => {
  const h = harness();
  const saved = process.env.XDG_CONFIG_HOME;
  try {
    process.env.XDG_CONFIG_HOME = "/xdg";
    assert.equal(
      new h.NoteFileChoice({}).configFile,
      join("/xdg", "aic", "note-file.json"),
    );
    delete process.env.XDG_CONFIG_HOME;
    assert.equal(
      new h.NoteFileChoice({}).configFile,
      join(homedir(), ".config", "aic", "note-file.json"),
    );
  } finally {
    if (saved === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved;
  }
  // Web extension host: no config file, the URI goes to globalState.
  const web = new h.NoteFileChoice({
    globalState: {
      get: (key) => h.state.get(key),
      update: async (key, value) => h.state.set(key, value),
    },
    configDir: null,
  });
  assert.equal(web.configFile, null);
  assert.equal(await web.read(), null);
  await web.write({
    scheme: "vscode-vfs",
    toString: () => "vscode-vfs://github/o/r/aic.md",
  });
  assert.deepEqual(
    [...h.state],
    [["aicNotes.noteFile", "vscode-vfs://github/o/r/aic.md"]],
  );
  assert.equal(String(await web.read()), "vscode-vfs://github/o/r/aic.md");
});

test("a missing, malformed or unreadable note-file.json is no choice; choosing again replaces it", async () => {
  const h = live({ noteFile: null });
  const a = h.addFile("a.js");
  mkdirSync(h.configDir, { recursive: true });
  for (const text of [
    "not json",
    '{"schemaVersion":2,"path":"/home/me/aic.md"}',
    '{"schemaVersion":1,"path":"aic.md"}',
    '{"schemaVersion":1,"path":"/home/me/"}',
    '{"schemaVersion":1}',
    `{"schemaVersion":1,"path":"/a.md","pad":"${"x".repeat(17000)}"}`,
  ]) {
    writeFileSync(h.configFile, text);
    assert.equal(await h.choice.read(), null, text.slice(0, 40));
    assert.match(
      h.choice.problem,
      /note-file\.json is not a valid note file choice$/u,
    );
  }
  assert.equal(await h.activate(a), false);
  assert.match(
    h.of("paneState").at(-1).problem,
    /note-file\.json is not a valid note file choice$/u,
  );
  rmSync(h.configFile);
  mkdirSync(h.configFile);
  assert.equal(await h.choice.read(), null);
  assert.match(h.choice.problem, /note-file\.json could not be read$/u);
  rmSync(h.configFile, { recursive: true });
  assert.equal(await h.choice.read(), null);
  assert.equal(h.choice.problem, "");

  writeFileSync(h.configFile, "broken", { mode: 0o644 });
  h.vscode.window.showQuickPick = async (items) => items[1];
  h.vscode.window.showSaveDialog = async () => h.uri("/workspace/aic.md");
  await h.pane.onMessage({ type: "note.choose" });
  assert.equal(
    JSON.parse(readFileSync(h.configFile, "utf8")).path,
    "/workspace/aic.md",
  );
  assert.equal(statSync(h.configFile).mode & 0o777, 0o600);
  assert.equal(h.client.page.target, "/workspace/a.js");
  assert.equal(h.of("paneState").at(-1).problem, "");
});

test("a note file chosen in the code editor is picked up on the next follow and on window focus; an unsaved draft is saved first", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const first = h.addFile("aic.md", "--- /workspace/a.js\nfirst\n");
  const second = h.uri("/home/me/notes.md");
  h.files.set(second.path, {
    type: 1,
    text: "--- /workspace/a.js\nsecond\n",
  });
  await h.activate(a);
  assert.equal(h.client.page.text, "first");
  await h.client.type("!");
  h.chooseInCodeEditor(second.path);
  await h.activate(a);
  assert.equal(h.files.get(first.path).text, "--- /workspace/a.js\nfirst!\n");
  assert.equal(h.of("init").at(-1).resourceUri, second.toString());
  assert.equal(h.client.page.text, "second");
  assert.equal(h.pane.view.title, "a.js");
  // If that save fails the pane stays on the unsaved note.
  await h.client.type("?");
  h.client.saveReply = false;
  h.chooseInCodeEditor(first.path);
  assert.equal(await h.activate(a), false);
  assert.equal(h.pane.documentUri.path, second.path);
  assert.equal(h.client.text, "--- /workspace/a.js\nsecond?\n");
  assert.equal(h.files.get(second.path).text, "--- /workspace/a.js\nsecond\n");
  assert.deepEqual(h.events.saved, [first.path]);
  // The choice removed in the code editor: a clean pane asks for it again.
  h.client.saveReply = true;
  h.chooseInCodeEditor(null);
  assert.equal(await h.activate(a), true);
  assert.equal(h.pane.documentUri ?? h.pane.placeholderUri, undefined);
  assert.equal(h.files.get(second.path).text, "--- /workspace/a.js\nsecond?\n");
  assert.equal(h.pane.view.title, "Linked Note");
  assert.equal(h.of("paneState").at(-1).hasSurface, false);

  h.chooseInCodeEditor(first.path);
  // The registered pane re-reads the choice when the window gets focus.
  let focus;
  h.vscode.window.onDidChangeWindowState = (listener) => {
    focus = listener;
    return { dispose() {} };
  };
  const pane = h.SecondaryNotePane.register(h.context, undefined, h.choice);
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { uri: a } };
  focus({ focused: true });
  await pane.navigation.tail;
  assert.equal(pane.documentUri.path, first.path);
  assert.equal(pane.focusTarget, "/workspace/a.js");
  h.chooseInCodeEditor(second.path);
  focus({ focused: false });
  await pane.navigation.tail;
  assert.equal(pane.documentUri.path, first.path);
  focus({ focused: true });
  await pane.navigation.tail;
  assert.equal(pane.documentUri.path, second.path);
  pane.dispose();
});

test("page targets are full paths: Windows paths use / and match in any case", async () => {
  const h = live();
  const win = (fsPath) => ({
    scheme: "file",
    path: `/${fsPath.replaceAll("\\", "/")}`,
    fsPath,
    toString: () => `file:///${fsPath.replaceAll("\\", "/")}`,
  });
  assert.equal(
    h.pageTarget(win("c:\\Work\\App\\src\\a.ts")),
    "c:/Work/App/src/a.ts",
  );
  assert.equal(h.pageTarget(h.uri("/srv/app/")), "/srv/app/");
  assert.equal(
    h.pageTarget({ scheme: "untitled", toString: () => "untitled:1" }),
    null,
  );
  h.vscode.workspace.fs.isWritableFileSystem = (scheme) =>
    scheme === "vscode-vfs" ? true : undefined;
  assert.equal(
    h.pageTarget({
      scheme: "vscode-vfs",
      toString: () => "vscode-vfs://github/o/r/a.js",
    }),
    "vscode-vfs://github/o/r/a.js",
  );
  assert.equal(
    h.pageTarget({ scheme: "git", toString: () => "git:/a.js?ref" }),
    null,
  );
  const note = h.addFile("aic.md", "--- C:\\WORK\\app\\src\\a.ts\nabout a\n");
  await h.activate(win("c:\\work\\app\\src\\a.ts"));
  assert.equal(h.client.page.text, "about a");
  await h.activate(win("c:\\work\\app\\src\\b.ts"));
  await h.client.type("about b");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    "--- C:\\WORK\\app\\src\\a.ts\nabout a\n\n--- c:/work/app/src/b.ts\nabout b",
  );
  // `/a`, `./a` and `a` are different targets.
  h.getDocument(note).replace(0, 0, "--- ./srv/x.js\nrelative\n\n");
  await h.activate(h.uri("/srv/x.js"));
  assert.equal(h.client.page.exists, false);
});

test("a read-only workspace shows the card and writes nothing", async () => {
  const h = live({ readOnly: true });
  const a = h.addFile("a.js");
  await h.activate(a);
  assert.deepEqual(
    [h.of("init")[0].readOnly, h.of("init")[0].placeholder],
    [true, true],
  );
  assert.equal(h.client.page.target, "/workspace/a.js");
  assert.equal(await h.client.type("blocked"), false);
  assert.equal(h.client.text, "");
  await assert.rejects(
    h.pane.commitDraft(
      "--- /workspace/a.js\nforced",
      h.client.generation,
      1,
      "aic.md",
    ),
    /read-only/u,
  );
  assert.equal(h.files.has("/workspace/aic.md"), false);
  assert.equal(h.of("committed").at(-1).saved, false);
  h.untouched();

  const existing = live({ readOnly: true });
  const note = existing.addFile("aic.md", "--- /workspace/a.js\nabout a\n");
  await existing.activate(existing.addFile("a.js"));
  assert.equal(existing.client.page.text, "about a");
  assert.equal(await existing.client.type("!"), false);
  assert.equal(
    existing.files.get(note.path).text,
    "--- /workspace/a.js\nabout a\n",
  );
  existing.untouched();
});

test("an external change to aic.md while a page is focused is applied and the focus kept", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const note = h.addFile(
    "aic.md",
    "--- /workspace/a.js\nabout a\n\n--- /workspace/b.js\nabout b\n",
  );
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
    "# Title\n\n--- /workspace/a.js\nA changed\n\n--- /workspace/b.js\nabout b\ntail\n",
  );
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["/workspace/a.js", "A changed"],
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
  const note = h.addFile("aic.md", "--- /workspace/a.js\nfrom git\n");
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
  assert.equal(h.client.text, "--- /workspace/a.js\nmine");
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
  const draft =
    "--- /workspace/a.js\nmine  \n  a\t\n\n--- /workspace/lib/b.js\nabout b";
  assert.equal(h.client.text, draft);
  const theirs = "---\ntitle: t\n---\n# Theirs\n\n--- /workspace/c.js\nabout c";
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
    ["/workspace/a.js", "mine  \n  a\t"],
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
      assert.equal(h.client.text, "--- /workspace/a.js\nmine");
      assert.equal(h.pane.draftDirty, true);
    }
    h.vscode.workspace.applyEdit = apply;
    document.save = save;
    assert.equal((await h.client.save()).saved, true);
    assert.equal(
      h.files.get(note.path).text,
      "theirs\n\n--- /workspace/a.js\nmine",
    );
    assert.equal(h.client.text, "theirs\n\n--- /workspace/a.js\nmine");
    assert.equal(h.pane.documentUri.path, note.path);
  });
}

test("a placeholder draft that collides with the appeared note is kept and saved once resolved", async () => {
  const h = live();
  const a = h.addFile("a.js");
  await h.activate(a);
  await h.client.type("mine");
  const theirs = "intro\n\n--- /workspace/a.js\nfrom git\n";
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
    assert.equal(h.client.text, "--- /workspace/a.js\nmine");
    assert.equal(h.pane.draftDirty, true);
    assert.equal(h.pane.placeholderUri.path, note.path);
    assert.equal(h.pane.documentUri, undefined);
  }
  assert.match(
    h.of("paneState").at(-1).status,
    /^Note appeared on disk with this page · draft kept/u,
  );
  // The user moves the other page out of the way; the next Ctrl+S lands.
  h.getDocument(note).replace(7, 26, "--- /workspace/old-a.js");
  const resolved = "intro\n\n--- /workspace/old-a.js\nfrom git\n";
  assert.equal(h.getDocument(note).getText(), resolved);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    `${resolved}\n--- /workspace/a.js\nmine`,
  );
  assert.equal(h.client.text, `${resolved}\n--- /workspace/a.js\nmine`);

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
  const base =
    "# T  \n\n--- /workspace/a.js\nabout a\n\n--- /workspace/b.js\nabout b\n";
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
    ["/workspace/a.js", "about a mine\t"],
  );
  assert.equal(h.pane.draftDirty, false);

  // The same page changed in both places, in different words of it: nothing
  // is written, the draft stays, and the save lands once the other change
  // is taken back.
  await h.client.type(" again");
  const mine = h.client.text;
  const before = document.getText();
  const page = before.indexOf("about a mine\t");
  document.replace(page, page + 5, "ABOUT");
  const conflicting = document.getText();
  const applied = h.events.applied.length;
  const refused = await h.client.save();
  assert.equal(refused.action, "stale-draft");
  assert.equal(document.getText(), conflicting);
  assert.equal(h.events.applied.length, applied);
  assert.equal(h.client.text, mine);
  assert.equal(h.pane.draftDirty, true);
  assert.deepEqual(h.events.saved, [note.path]);
  assert.equal(h.files.get(note.path).text, before);
  assert.equal(h.of("committed").at(-1).saved, false);
  assert.match(
    h.of("paneState").at(-1).status,
    /^This page changed in the file too · draft kept in the editor\. /u,
  );
  assert.equal(h.of("paneState").at(-1).discard, true);
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.equal(document.getText(), conflicting);
  document.replace(page, page + 5, "about");
  assert.equal(document.getText(), before);
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, mine);
  assert.equal(h.client.text, mine);
});

test("external changes on both sides of the dirty page are merged by pages, byte-exact", async () => {
  const h = live();
  const a = h.addFile("src/a.js");
  const base =
    "intro \t\n\n--- /workspace/src/a.js\nabout a\n\n--- /workspace/b.js\nabout b  \n\n--- /workspace/c.js\nabout c";
  const note = h.addFile("aic.md", base);
  await h.activate(a);
  await h.client.type(" MINE");
  const document = h.getDocument(note);
  const c = base.indexOf("about c");
  document.replace(c, c + 7, "C theirs\n\n\n");
  document.replace(0, 5, "INTRO");
  const theirs = document.getText();
  assert.equal(
    theirs,
    "INTRO \t\n\n--- /workspace/src/a.js\nabout a\n\n--- /workspace/b.js\nabout b  \n\n--- /workspace/c.js\nC theirs\n\n\n",
  );
  assert.equal(h.client.text, base.replace("about a", "about a MINE"));

  const result = await h.client.save();
  assert.equal(result.saved, true);
  const merged = theirs.replace("about a", "about a MINE");
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(h.of("committed").at(-1).text, merged);
  assert.equal(h.client.text, merged);
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["/workspace/src/a.js", "about a MINE"],
  );
  assert.equal(h.pane.draftDirty, false);
  assert.equal(h.of("paneState").at(-1).status, "");

  // A change only before, then only after, the dirty page.
  for (const [find, text] of [
    ["INTRO", "# Intro\n"],
    ["about b  ", "B\t"],
  ]) {
    await h.client.type("!");
    const at = document.getText().indexOf(find);
    document.replace(at, at + find.length, text);
    const expected = document.getText().replace("MINE", "MINE!");
    assert.equal((await h.client.save()).saved, true);
    assert.equal(h.files.get(note.path).text, expected);
    assert.equal(h.client.text, expected);
    document.replace(
      document.getText().indexOf("MINE!"),
      document.getText().indexOf("MINE!") + 5,
      "MINE",
    );
    assert.equal(await document.save(), true);
    assert.equal(h.client.text, document.getText());
  }
});

test("a page added in the pane is appended to the changed file unless the file has it now", async () => {
  const h = live();
  const x = h.addFile("new/x.js");
  const base = "intro\n\n--- /workspace/a.js\nabout a\n";
  const note = h.addFile("aic.md", base);
  await h.activate(x);
  await h.client.type("mine\n\tx  ");
  const document = h.getDocument(note);
  document.replace(0, 5, "INTRO\t");
  const theirs = document.getText();
  assert.equal((await h.client.save()).saved, true);
  const merged = `${theirs}\n--- /workspace/new/x.js\nmine\n\tx  `;
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(merged.startsWith(theirs), true);
  assert.equal(h.client.text, merged);
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["/workspace/new/x.js", "mine\n\tx  "],
  );

  // The file gained that page meanwhile: a conflict, nothing is written.
  const y = h.addFile("y.js");
  await h.activate(y);
  await h.client.type("mine");
  const draft = h.client.text;
  document.replace(
    document.getText().length,
    document.getText().length,
    "\n\n--- /workspace/Y.JS\ntheirs",
  );
  const conflicting = document.getText();
  const applied = h.events.applied.length;
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.equal(document.getText(), conflicting);
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(h.events.applied.length, applied);
  assert.equal(h.client.text, draft);
  assert.equal(h.pane.draftDirty, true);
  assert.match(
    h.of("paneState").at(-1).status,
    /^This page changed in the file too · draft kept/u,
  );
});

test("a structural draft change or a repeated target is saved only onto an unchanged file", async () => {
  const h = live();
  const base =
    "intro\n\n--- /workspace/a.js\nabout a\n\n--- /workspace/b.js\nabout b\n";
  const note = h.addFile("aic.md", base);
  await h.activate(undefined);
  const document = h.getDocument(note);
  // The draft renames page a; the file changes on page b.
  await h.client.replace(
    base.indexOf("a.js"),
    base.indexOf("a.js") + 4,
    "z.js",
  );
  const draft = h.client.text;
  const b = base.indexOf("about b");
  document.replace(b, b + 7, "B");
  const conflicting = document.getText();
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.equal(document.getText(), conflicting);
  assert.deepEqual(h.events.applied, []);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.client.text, draft);
  assert.equal(h.pane.draftDirty, true);
  const state = h.of("paneState").at(-1);
  assert.match(
    state.status,
    /^Pages were added, removed, renamed or repeated and the file changed too · draft kept/u,
  );
  assert.equal(state.discard, true);
  // The file is again what the draft started from: saved as typed.
  document.replace(b, b + 1, "about b");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, draft);

  // A target the file now has twice cannot be matched to the draft.
  await h.client.type("mine");
  const mine = h.client.text;
  const end = document.getText().length;
  document.replace(end, end, "\n--- /workspace/B.js\nagain\n");
  const twice = document.getText();
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.equal(document.getText(), twice);
  assert.equal(h.client.text, mine);
  assert.match(h.of("paneState").at(-1).status, /^Pages were added, removed/u);
});

test("unbound text of the whole-note view merges with a change on a bound page", async () => {
  const h = live();
  const base = "intro\n\n--- /workspace/a.js\nabout a\n\n---\nloose\n";
  const note = h.addFile("aic.md", base);
  await h.activate(undefined);
  await h.client.replace(0, 5, "INTRO  ");
  await h.client.replace(
    h.client.text.indexOf("loose"),
    h.client.text.indexOf("loose") + 5,
    "LOOSE",
  );
  const document = h.getDocument(note);
  const a = base.indexOf("about a");
  document.replace(a, a + 7, "A theirs\t\n");
  const theirs = document.getText();
  assert.equal((await h.client.save()).saved, true);
  const merged = theirs.replace("intro", "INTRO  ").replace("loose", "LOOSE");
  assert.equal(h.files.get(note.path).text, merged);
  assert.equal(h.client.text, merged);
  // The leading text changed on both sides.
  await h.client.replace(0, 5, "Mine");
  document.replace(8, 8, "theirs");
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.match(
    h.of("paneState").at(-1).status,
    /^This page changed in the file too/u,
  );
  assert.equal(h.files.get(note.path).text, merged);
});

test("Discard my changes and reload drops the draft for the document text after a confirmation", async () => {
  const h = live();
  const a = h.addFile("a.js");
  const base =
    "intro\n\n--- /workspace/a.js\nabout a\n\n--- /workspace/b.js\nabout b\n";
  const note = h.addFile("aic.md", base);
  await h.activate(a);
  await h.client.type(" mine");
  const draft = h.client.text;
  const document = h.getDocument(note);
  document.replace(
    base.indexOf("about a"),
    base.indexOf("about a") + 5,
    "ABOUT",
  );
  const theirs = document.getText();
  assert.equal((await h.client.save()).action, "stale-draft");
  assert.equal(h.of("paneState").at(-1).discard, true);

  // Cancelled (or dismissed): nothing changes.
  const asked = [];
  h.vscode.window.showWarningMessage = async (...args) => {
    asked.push(args);
    return undefined;
  };
  await h.client.discard();
  assert.equal(asked.length, 1);
  assert.match(asked[0][0], /^Discard your unsaved changes in aic\.md/u);
  assert.equal(asked[0][1].modal, true);
  assert.equal(asked[0][2], "Discard and reload");
  assert.equal(h.client.text, draft);
  assert.equal(h.pane.draftDirty, true);
  assert.deepEqual(h.of("reset"), []);

  // Confirmed: the pane shows the document again and the file is untouched.
  h.vscode.window.showWarningMessage = async (...args) => args.at(-1);
  await h.client.discard();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.client.text, theirs);
  assert.equal(h.client.dirty, false);
  assert.equal(h.client.stale, false);
  assert.equal(h.client.generation, h.pane.generation);
  assert.deepEqual(
    [h.client.page.target, h.client.page.text],
    ["/workspace/a.js", "ABOUT a"],
  );
  assert.equal(h.pane.draftDirty, false);
  assert.equal(document.getText(), theirs);
  assert.deepEqual(h.events.applied, []);
  assert.deepEqual(h.events.saved, []);
  assert.equal(h.of("paneState").at(-1).status, "");
  assert.equal(h.of("paneState").at(-1).discard, false);
  // The pane is an ordinary clean editor again.
  await h.client.type(" again");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    theirs.replace("ABOUT a", "ABOUT a again"),
  );

  // Never while a save is running, and never for another note path.
  await h.client.type("!");
  h.pane.savingLease++;
  await h.client.discard();
  h.pane.savingLease--;
  await h.pane.onMessage({ type: "draft.discard", relativePath: "other.md" });
  assert.equal(h.of("reset").length, 1);
  assert.equal(h.pane.draftDirty, true);
});

test("the pane and the main tab of aic.md share one edit lease", async () => {
  const h = live({ ownership: true });
  const a = h.addFile("a.js");
  const note = h.addFile("aic.md", "--- /workspace/a.js\nabout a\n");
  const readme = h.addFile("README.md", "plain");
  await h.activate(a);
  assert.equal(h.client.state.readOnly, false);
  await h.client.type("!");
  const provider = new h.MarkdownEditorProvider(
    h.context,
    h.ownership,
    h.choice,
  );
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
  assert.equal(h.getDocument(note).getText(), "--- /workspace/a.js\nabout a\n");
  assert.ok(
    panel.messages.some((message) => message.type === "editingRejected"),
  );
  assert.equal((await h.client.save()).saved, true);
  assert.equal(h.files.get(note.path).text, "--- /workspace/a.js\nabout a!\n");
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

test("Open target opens an existing file by its full path or an http(s) URL and refuses everything else", async () => {
  const h = live();
  h.vscode.workspace.fs.isWritableFileSystem = (scheme) =>
    scheme === "file" ? true : undefined;
  const a = h.addFile("src/a.js");
  h.addFile("src", "", 2);
  const note = h.addFile("aic.md", "--- /workspace/src/a.js\nabout a\n");
  await h.activate(a);
  for (const target of [
    "/workspace/src/a.js",
    " /workspace/src/a.js\t",
    "\\workspace\\src\\a.js",
    "file:///workspace/src/a.js",
  ]) {
    h.commands.length = 0;
    await h.pane.onMessage({ type: "page.openTarget", target });
    assert.deepEqual(
      h.commands.map(([command, resource]) => [command, resource.path]),
      [["vscode.open", a.path]],
      target,
    );
  }
  await h.pane.onMessage({
    type: "page.openTarget",
    target: "https://example.com/docs?q=1",
  });
  assert.deepEqual(h.events.external, ["https://example.com/docs?q=1"]);
  assert.deepEqual(h.events.errors, []);

  h.commands.length = 0;
  const provider = new h.MarkdownEditorProvider(h.context, undefined, h.choice);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(h.getDocument(note), panel);
  const refused = [
    // Relative paths: no base to resolve them against.
    "src/a.js",
    "./src/a.js",
    "../outside.js",
    // A folder, a missing file and the root.
    "/workspace/src",
    "/workspace/src/missing.js",
    "C:/Windows/missing.ini",
    "/",
    "",
    // Schemes without a file system, and control characters.
    "javascript:alert(1)",
    "vscode://settings",
    "command:workbench.action.terminal.new",
    "/workspace/src/a.js\u0000",
  ];
  for (const target of refused) {
    await h.pane.onMessage({ type: "page.openTarget", target });
    await panel.send({ type: "page.openTarget", target });
  }
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.events.external, ["https://example.com/docs?q=1"]);
  assert.equal(h.events.errors.length, refused.length * 2);
  await panel.send({ type: "page.openTarget", target: "/workspace/src/a.js" });
  assert.deepEqual(
    h.commands.map(([command, resource]) => [command, resource.path]),
    [["vscode.open", a.path]],
  );
  provider.dispose();
  h.untouched();
});

test("a workspace with an old aic.md and legacy .note.md files is byte-identical after following files and saving a page", async () => {
  const h = live({ noteFile: "/home/me/notes.md" });
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
  // The per-workspace note of the earlier version is now an ordinary file.
  const old = h.addFile("aic.md", "--- src/a.js\nold page\n");
  const note = h.uri("/home/me/notes.md");
  h.files.set(note.path, { type: 1, text: "existing\n" });
  const before = new Map(
    [...h.files].map(([name, file]) => [name, JSON.stringify(file)]),
  );
  await h.activate(a);
  await h.activate(b);
  await h.activate(legacy);
  // A legacy sidecar is an ordinary file: it is not followed as a note.
  assert.equal(h.client.page.target, "/workspace/src/a.note.md");
  await h.activate(old);
  assert.equal(h.client.page.target, "/workspace/aic.md");
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
    "existing\n\n--- /workspace/src/b.ts\nabout b",
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

test("an old aic.md chosen as the note file keeps its relative pages byte-exact; new pages use full paths", async () => {
  const h = live();
  const a = h.addFile("src/a.js");
  const original = "# Project\n\n--- src/a.js\nold page\n";
  const note = h.addFile("aic.md", original);
  await h.activate(a);
  // `src/a.js` is not the full path of the file, so it is not its page.
  assert.equal(h.client.page.exists, false);
  await h.client.type("new page");
  assert.equal((await h.client.save()).saved, true);
  assert.equal(
    h.files.get(note.path).text,
    `${original}\n--- /workspace/src/a.js\nnew page`,
  );
});
