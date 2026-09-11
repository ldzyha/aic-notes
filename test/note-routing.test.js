import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {openNoteDocument} from "./src/notes/create.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js";',
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
  const commands = [];
  const registrations = new Map();
  const changes = new Set();
  const saveListeners = new Set();
  const willSaveListeners = new Set();
  const files = new Map([["/workspace", { type: 2 }]]);
  const documents = new Map();
  const events = { opened: [], closed: [], writes: [], saved: [], errors: [] };
  const tabGroups = {
    activeTabGroup: {},
    all: [],
    close: async (tab) => events.closed.push(tab),
    onDidChangeTabs: () => disposable(),
    onDidChangeTabGroups: () => disposable(),
  };
  const disposable = () => ({ dispose() {} });
  const addFile = (name, text = "note", type = 1) => {
    const resource = uri(`/workspace/${name}`);
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
    Uri: {
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
    WorkspaceEdit: class {
      edits = [];
      replace(resource, range, text) {
        this.edits.push({ resource, range, text });
      }
    },
    workspace: {
      get textDocuments() {
        return [...documents.values()];
      },
      workspaceFolders: [folder],
      getWorkspaceFolder: (resource) =>
        resource.path.startsWith("/workspace") ? folder : undefined,
      asRelativePath: (resource) =>
        resource.path.replace(/^\/workspace\/?/u, ""),
      fs: {
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
      }),
    },
    commands: {
      executeCommand: async (...args) => {
        commands.push(args);
      },
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
      setStatusBarMessage() {},
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => (name === "vscode" ? vscode : require(name)),
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
    files,
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

test("Explorer note selection leaves both main tab and an unrelated dirty sidebar draft intact", async () => {
  const h = harness();
  const old = h.addFile("old.note.md");
  const next = h.addFile("next.note.md");
  h.pane.documentUri = old;
  h.pane.draftDirty = true;
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { uri: next } };
  assert.equal(await h.pane.followActive(), false);
  assert.equal(h.pane.documentUri, old);
  assert.equal(h.pane.draftDirty, true);
  assert.deepEqual(h.sent, []);
  assert.deepEqual(h.events.closed, []);
  assert.deepEqual(h.events.opened, []);
});

test("queued follow reads the latest tab instead of reviving an old source selection", async () => {
  const h = harness();
  const source = h.addFile("file.js");
  const note = h.addFile("file.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: source },
  };
  const pending = h.pane.followActive();
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { uri: note } };
  assert.equal(await pending, false);
  assert.deepEqual(h.events.opened, []);
});

test("a normal file still follows its sidecar without closing a main note tab", async () => {
  const h = harness();
  const source = h.addFile("file.js");
  const note = h.addFile("file.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: source },
  };
  assert.equal(await h.pane.followActive(), true);
  assert.equal(h.pane.documentUri.toString(), note.toString());
  assert.deepEqual(h.events.closed, []);
  assert.deepEqual(h.events.writes, []);
});

test("Open source requires saving a dirty main note, then opens source plus sidebar without further writes", async () => {
  const h = harness();
  const source = h.addFile("file.js");
  const note = h.addFile("file.note.md");
  const main = h.getDocument(note);
  main.replace(0, 0, "unsaved main ");
  await assert.rejects(
    h.pane.openSourceForNote(note),
    (error) => error.structured?.error === "notes_unsaved",
  );
  assert.deepEqual(h.events.saved, []);
  assert.deepEqual(h.commands, []);
  await main.save();
  h.events.saved.length = 0;
  assert.equal(await h.pane.openSourceForNote(note), true);
  assert.equal(h.pane.document, main);
  assert.equal(main.isDirty, false);
  assert.equal(h.commands[0][0], "vscode.open");
  assert.equal(h.commands[0][1].toString(), source.toString());
  assert.deepEqual(h.events.saved, []);
  assert.deepEqual(h.events.closed, []);
  assert.deepEqual(h.events.writes, []);
});

test("ambiguous extension-stripped sources are refused instead of choosing a sibling", async () => {
  const h = harness();
  h.addFile("file.js");
  h.addFile("file.ts");
  const note = h.addFile("file.note.md");
  await assert.rejects(
    h.pane.openSourceForNote(note),
    (error) => error.structured?.error === "notes_source_ambiguous",
  );
  assert.deepEqual(h.commands, []);
});

test("Open source cannot replace a different dirty sidebar or overwrite the same draft", async () => {
  const h = harness();
  const old = h.addFile("old.note.md");
  const note = h.addFile("file.note.md");
  h.addFile("file.js");
  h.pane.documentUri = old;
  h.pane.draftDirty = true;
  assert.equal(await h.pane.openSourceForNote(note), false);
  assert.equal(h.pane.documentUri, old);
  assert.deepEqual(h.commands, []);
  h.pane.documentUri = note;
  h.sent.length = 0;
  assert.equal(await h.pane.openSourceForNote(note), true);
  assert.equal(h.pane.draftDirty, true);
  assert.equal(h.sent.includes("init"), false);
});

test("project and folder source actions reveal their directory rather than opening it as text", async () => {
  for (const [name, directory] of [
    ["workspace.note.md", "/workspace"],
    ["docs.note.md", "/workspace/docs"],
  ]) {
    const h = harness();
    h.addFile("docs", undefined, 2);
    const note = h.addFile(name);
    assert.equal(await h.pane.openSourceForNote(note), true);
    assert.equal(h.commands[0][0], "revealInExplorer");
    assert.equal(h.commands[0][1].path, directory);
    assert.deepEqual(h.events.writes, []);
  }
});

test("orphan notes open in main without creating a source, and Open source reports the missing owner", async () => {
  const h = harness();
  const note = h.addFile("orphan.note.md");
  await h.openNoteDocument(note);
  assert.equal(h.commands[0][0], "vscode.openWith");
  assert.equal(h.commands[0][2], "aicNotes.markdown");
  await assert.rejects(
    h.pane.openSourceForNote(note),
    (error) => error.structured?.error === "notes_orphan",
  );
  assert.deepEqual(h.events.writes, []);
});

test("legacy note association resolves to the same main provider without disposing or redirecting", async () => {
  const h = harness();
  const provider = h.MarkdownEditorProvider.register(h.context);
  assert.equal(h.registrations.get("aicNotes.markdown"), provider);
  assert.equal(h.registrations.get("aicNotes.noteRedirect"), provider);
  for (const name of ["workspace.note.md", "docs.note.md", "file.note.md"]) {
    const panel = h.panel();
    await provider.resolveCustomTextEditor(
      h.getDocument(h.addFile(name)),
      panel,
    );
    await panel.send({ type: "ready" });
    assert.equal(panel.disposed, false);
    assert.match(panel.webview.html, /id="document-source"/u);
    assert.equal(panel.messages[0].type, "init");
    assert.deepEqual(h.commands, []);
  }
  provider.dispose();
});

test("main-note edits stay in TextDocument until Ctrl+S; source action never saves", async () => {
  const h = harness();
  const resource = h.addFile("file.note.md", "body");
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
  await panel.send({ type: "source.open" });
  assert.equal(h.commands[0][0], "aicNotes.openSource");
  assert.deepEqual(h.events.saved, []);
  await panel.send({ type: "save" });
  assert.deepEqual(h.events.saved, [resource.path]);
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.match(document.getText(), /body changed/u);
  assert.equal(
    panel.messages.filter((message) => message.type === "external").length,
    1,
  );
  assert.deepEqual(h.events.errors, []);
});

test("a main edit notifies the sidebar without replacing its dirty draft; stale sidebar save is rejected", async () => {
  const h = harness();
  const resource = h.addFile("file.note.md", "body");
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
  const result = await h.pane.commitDraft(
    "sidebar unsaved",
    0,
    1,
    "file.note.md",
  );
  assert.equal(result.action, "stale-draft");
  assert.equal(document.getText(), "body main");
  assert.equal(
    h.sent.find((message) => message?.type === "committed").saved,
    false,
  );
});

test("manifest defaults target the main editor, retains optional legacy association and exposes source actions", async () => {
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
  for (const menu of ["editor/title", "explorer/context", "view/item/context"])
    assert.ok(
      manifest.contributes.menus[menu].some(
        (entry) => entry.command === "aicNotes.openSource",
      ),
    );
});

test("dirty sidebar opens main read-only, rejects stale main edits, and unlocks main after explicit sidebar save", async () => {
  const h = harness(true);
  const resource = h.addFile("file.note.md", "base");
  const document = h.getDocument(resource);
  h.pane.documentUri = resource;
  h.pane.document = document;
  h.pane.draftDirty = true;
  await h.ownership.activate(h.pane.editSurface);
  const sidebarLease = h.ownership.state(h.pane.editSurface).lease;
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
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
    "file.note.md",
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
    "file.note.md",
    sidebarLease,
  );
  assert.equal(stale.action, "not-owner");
  assert.equal(document.getText(), saved);
});

test("dirty main cannot transfer ownership or open source, and queued sidebar commits cannot mutate it", async () => {
  const h = harness(true);
  h.addFile("file.js");
  const resource = h.addFile("file.note.md", "base");
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
    "file.note.md",
    initial.lease,
  );
  assert.equal(stale.action, "not-owner");
  assert.equal(document.getText(), "base main");
  await assert.rejects(
    h.pane.openSourceForNote(resource),
    (error) => error.structured?.error === "notes_unsaved",
  );
  assert.deepEqual(h.events.saved, []);
});

test("clean ownership transfer probes the old webview and native manual Save stamps once and unlocks waiting sidebar", async () => {
  const h = harness(true);
  const resource = h.addFile("file.note.md", "base");
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
  const edits = [];
  for (const listener of h.willSaveListeners)
    listener({
      document,
      reason: h.vscode.TextDocumentSaveReason.Manual,
      waitUntil: (value) => edits.push(value),
    });
  assert.equal(edits.length, 1);
  const prepared = await edits[0];
  assert.equal(prepared.length, 0);
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.equal(document.isDirty, true);
  await document.save();
  await h.ownership.queue;
  assert.equal(h.ownership.state(h.pane.editSurface).readOnly, false);
  assert.ok(panel.messages.some((message) => message.type === "editing.probe"));
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.equal(h.events.saved.length, 1);
  const sideOwnerEdits = [];
  for (const listener of h.willSaveListeners)
    listener({
      document,
      reason: h.vscode.TextDocumentSaveReason.Manual,
      waitUntil: (value) => sideOwnerEdits.push(value),
    });
  assert.equal(
    sideOwnerEdits.length,
    0,
    "the inactive main editor must not stamp a sidebar save again",
  );
});

test("native manual Save never stamps over optimistic client text still in flight", async () => {
  const h = harness(true);
  const document = h.getDocument(h.addFile("file.note.md", "base"));
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: "base + in-flight input",
        dirty: false,
      });
  };
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  const pending = [];
  for (const listener of h.willSaveListeners)
    listener({
      document,
      reason: h.vscode.TextDocumentSaveReason.Manual,
      waitUntil: (value) => pending.push(value),
    });
  assert.equal((await pending[0]).length, 0);
  assert.equal(document.getText(), "base");
  assert.equal(
    panel.messages.filter((message) => message.type === "editingState").at(-1)
      .readOnly,
    false,
  );
});
