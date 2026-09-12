import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents:
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js"; export {linkSelectionToNote} from "./src/notes/selection.js"; export {createNoteDocument} from "./src/notes/operation.js"; export {trashNotesLocally} from "./src/notes/delete.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

function harness() {
  const uri = (path) => ({
    scheme: "file",
    path,
    fsPath: path,
    toString: () => `file://${path}`,
  });
  const folder = { name: "workspace", uri: uri("/workspace") };
  const files = new Map([[folder.uri.path, { type: 2 }]]);
  const documents = new Map();
  const changeListeners = new Set();
  const willSaveListeners = new Set();
  const saved = [];
  const errors = [];
  const disposable = () => ({ dispose() {} });
  const addFile = (name, text = "body") => {
    const resource = uri(`/workspace/${name}`);
    files.set(resource.path, { type: 1, text });
    return resource;
  };
  function documentFor(resource) {
    if (documents.has(resource.path)) return documents.get(resource.path);
    let text = files.get(resource.path).text;
    const document = {
      uri: resource,
      isClosed: false,
      version: 1,
      isDirty: false,
      getText: () => text,
      positionAt: (offset) => offset,
      offsetAt: (offset) => offset,
      save: async () => {
        saved.push(text);
        files.get(resource.path).text = text;
        document.isDirty = false;
        return true;
      },
      replace: (from, to, insert) => {
        document.version++;
        text = text.slice(0, from) + insert + text.slice(to);
        document.isDirty = true;
        for (const listener of changeListeners)
          listener({
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
        uri([base.path, ...parts].join("/").replace(/\/+/gu, "/")),
    },
    FileType: { File: 1, Directory: 2 },
    Position: class {
      constructor(line, character) {
        Object.assign(this, { line, character });
      }
    },
    TextDocumentSaveReason: { Manual: 1 },
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    Range: class {
      constructor(from, to) {
        Object.assign(this, { from, to });
      }
    },
    WorkspaceEdit: class {
      edits = [];
      createFile(resource, options) {
        this.create = { resource, options };
      }
      insert(resource, _position, text) {
        this.replace(resource, { from: 0, to: 0 }, text);
      }
      replace(resource, range, text) {
        this.edits.push({ resource, range, text });
      }
    },
    workspace: {
      getWorkspaceFolder: () => folder,
      workspaceFolders: [folder],
      asRelativePath: (resource) =>
        resource.path.replace(/^\/workspace\/?/u, ""),
      fs: {
        stat: async (resource) => {
          if (!files.has(resource.path)) throw new Error("missing");
          return { ...files.get(resource.path), ctime: 1 };
        },
        readDirectory: async () => [],
      },
      openTextDocument: async (resource) => documentFor(resource),
      applyEdit: async (edit) => {
        if (edit.create) {
          const { resource, options } = edit.create;
          assert.equal(options.overwrite, false);
          if (files.has(resource.path)) return false;
          files.set(resource.path, { type: 1, text: "" });
        }
        for (const { resource, range, text } of edit.edits)
          documentFor(resource).replace(range.from, range.to, text);
        return true;
      },
      onDidChangeTextDocument: (listener) => {
        changeListeners.add(listener);
        return { dispose: () => changeListeners.delete(listener) };
      },
      onWillSaveTextDocument: (listener) => {
        willSaveListeners.add(listener);
        return { dispose: () => willSaveListeners.delete(listener) };
      },
    },
    commands: { executeCommand: async () => undefined },
    window: {
      showErrorMessage: (message) => errors.push(message),
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
  });
  const context = { extensionUri: uri("/extension") };
  const ownership = new module.exports.NoteEditOwnership();
  return {
    ...module.exports,
    context,
    ownership,
    vscode,
    addFile,
    documentFor,
    files,
    saved,
    errors,
    willSaveListeners,
    changeListeners,
    panel() {
      const messages = [];
      const panel = {
        active: true,
        messages,
        onDidDispose: disposable,
        webview: {
          cspSource: "test",
          asWebviewUri: (value) => value.toString(),
          postMessage: async (message) => {
            messages.push(message);
            return panel.onPost?.(message) ?? true;
          },
          onDidReceiveMessage: (listener) => {
            panel.send = listener;
            return disposable();
          },
        },
      };
      return panel;
    },
  };
}

async function mainEditor(h) {
  const resource = h.addFile("file.note.md", "body");
  const document = h.documentFor(resource);
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  const session = [...provider.sessions][0];
  return {
    resource,
    document,
    provider,
    panel,
    lease: h.ownership.state(session.editSurface).lease,
  };
}

function nativeSaveEdits(h, document) {
  const promises = [];
  for (const listener of h.willSaveListeners)
    listener({
      document,
      reason: h.vscode.TextDocumentSaveReason.Manual,
      waitUntil: (promise) => promises.push(promise),
    });
  return Promise.all(promises);
}

async function auditSidebar(h) {
  const uri = h.addFile("file.note.md", "base");
  const document = h.documentFor(uri);
  const pane = new h.SecondaryNotePane(h.context, h.ownership);
  pane.document = document;
  pane.documentUri = uri;
  pane.view = h.panel();
  pane.sendPaneState = async () => {};
  h.vscode.workspace.onDidChangeTextDocument((event) =>
    pane.onDocumentChanged(event),
  );
  await h.ownership.activate(pane.editSurface);
  return {
    pane,
    document,
    uri,
    lease: h.ownership.state(pane.editSurface).lease,
  };
}

for (const saved of [true, false]) {
  test(`sidebar navigation ${saved ? "saves the old draft before switching" : "keeps the old note after save failure"}`, async () => {
    const h = harness();
    const { pane, document, uri, lease } = await auditSidebar(h);
    pane.ready = true;
    pane.draftDirty = true;
    pane.sendInit = async () => {};
    const next = h.addFile("next.note.md", "next");
    const originalSave = document.save;
    document.save = async () => saved ? originalSave() : false;
    pane.view.onPost = (message) => {
      if (message.type === "draft.saveRequest") {
        void pane.commitDraft("base LOCAL", pane.generation, 71, "file.note.md", lease).then((result) => pane.onMessage({
          type: "draft.saveResult", requestId: message.requestId,
          relativePath: "file.note.md", saved: Boolean(result.saved),
        }));
      } else if (message.type === "editing.probe") {
        void pane.onMessage({ type: "editing.snapshot", requestId: message.requestId, text: document.getText(), dirty: false });
      }
      return true;
    };
    assert.equal(await pane.openNow(next, { reveal: false }), saved);
    assert.equal(pane.documentUri.toString(), (saved ? next : uri).toString());
    assert.match(document.getText(), /base LOCAL/u);
    assert.equal(pane.saveWaiters.size, 0);
    pane.dispose();
  });
}

test("a late successful sidebar save result cannot clear a newer dirty draft state", async () => {
  const h = harness();
  const { pane } = await auditSidebar(h);
  pane.ready = true;
  pane.draftDirty = true;
  let request;
  pane.view.onPost = (message) => { request = message; return true; };
  const flush = pane.flushDraftBeforeNavigation();
  pane.draftDirty = false;
  await pane.onMessage({ type: "draft.state", relativePath: "file.note.md", dirty: true, pending: false });
  await pane.onMessage({ type: "draft.saveResult", requestId: request.requestId, relativePath: "file.note.md", saved: true });
  assert.equal(await flush, false);
  assert.equal(pane.draftDirty, true);
  pane.dispose();
});

test("sidebar refuses a save if external text changes during metadata IO", async () => {
  const h = harness();
  const { pane, document, lease } = await auditSidebar(h);
  pane.draftDirty = true;
  const entered = deferred(),
    release = deferred();
  const stat = h.vscode.workspace.fs.stat;
  let first = true;
  h.vscode.workspace.fs.stat = async (uri) => {
    if (first) {
      first = false;
      entered.resolve();
      await release.promise;
    }
    return stat(uri);
  };
  const commit = pane.commitDraft("base LOCAL", 0, 1, "file.note.md", lease);
  await entered.promise;
  document.replace(4, 4, " EXTERNAL");
  release.resolve();
  assert.equal((await commit).saved, undefined);
  assert.equal(document.getText(), "base EXTERNAL");
  assert.equal(h.saved.length, 0);
  assert.equal(pane.draftDirty, true);
  assert.equal(
    pane.view.messages.filter((message) => message.type === "committed").at(-1)
      .saved,
    false,
  );
  pane.dispose();
});

test("Trash revalidates ownership after confirmation without implicitly saving", async () => {
  const h = harness();
  const { pane, document, uri, lease } = await auditSidebar(h);
  const prompted = deferred(),
    answer = deferred();
  h.vscode.window.showWarningMessage = async () => {
    prompted.resolve();
    return answer.promise;
  };
  h.vscode.workspace.fs.delete = async (target) => h.files.delete(target.path);
  const deletion = pane.trashCurrentNote(lease);
  await prompted.promise;
  const other = h.ownership.register({
    uri: () => uri,
    dirty: () => false,
    text: () => document.getText(),
    probe: async () => ({ text: document.getText(), dirty: false }),
    notify() {},
  });
  assert.equal(await h.ownership.activate(other), true);
  answer.resolve("Move to Trash");
  await deletion;
  assert.equal(h.files.has(uri.path), true);
  assert.equal(h.saved.length, 0);
  pane.dispose();
});

test("a save from a retired sidebar cannot acknowledge or modify its replacement", async () => {
  const h = harness();
  const { pane, document, lease } = await auditSidebar(h);
  const entered = deferred(),
    release = deferred();
  const stat = h.vscode.workspace.fs.stat;
  h.vscode.workspace.fs.stat = async (uri) => {
    entered.resolve();
    await release.promise;
    return stat(uri);
  };
  const commit = pane.commitDraft("obsolete", 0, 1, "file.note.md", lease);
  await entered.promise;
  pane.view = h.panel();
  release.resolve();
  await commit;
  assert.equal(document.getText(), "base");
  assert.equal(
    pane.view.messages.filter((message) => message.type === "committed").length,
    0,
  );
  assert.equal(h.saved.length, 0);
  pane.dispose();
});

test("a queued sidebar save retains its originating view", async () => {
  const h = harness();
  const { pane, document, lease } = await auditSidebar(h);
  const release = deferred();
  pane.editQueue = release.promise;
  const pending = pane.onMessage({
    type: "commit",
    text: "obsolete",
    generation: 0,
    requestId: 1,
    relativePath: "file.note.md",
    lease,
  });
  const origin = pane.view;
  pane.view = h.panel();
  release.resolve();
  await pending;
  assert.equal(document.getText(), "base");
  assert.equal(h.saved.length, 0);
  assert.equal(
    pane.view.messages.some((message) => message.type === "committed"),
    false,
  );
  assert.equal(
    origin.messages.find((message) => message.type === "committed")?.saved,
    false,
  );
  pane.dispose();
});

test("Trash confirmation cannot outlive its sidebar view", async () => {
  const h = harness();
  const { pane, uri, lease } = await auditSidebar(h);
  const prompted = deferred(),
    answer = deferred();
  h.vscode.window.showWarningMessage = async () => {
    prompted.resolve();
    return answer.promise;
  };
  h.vscode.workspace.fs.delete = async (target) => h.files.delete(target.path);
  const deletion = pane.trashCurrentNote(lease);
  await prompted.promise;
  pane.view = h.panel();
  answer.resolve("Move to Trash");
  await deletion;
  assert.equal(h.files.has(uri.path), true);
  pane.dispose();
});

test("provider disposal retires all live panels and queued messages", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  provider.dispose();
  const count = panel.messages.length;
  assert.equal(h.willSaveListeners.size, 0);
  assert.equal(h.changeListeners.size, 0);
  document.replace(4, 4, " external");
  await panel.send({
    type: "edit",
    generation: 0,
    lease,
    changes: [{ from: 0, to: 4, insert: "BAD" }],
  });
  assert.equal(panel.messages.length, count);
  assert.equal(document.getText(), "body external");
});

test("selection uses the active Markdown document instead of a stale native selection and never saves", async () => {
  const h = harness();
  const old = h.documentFor(h.addFile("old.js", "old"));
  const active = h.documentFor(h.addFile("active.md", "current"));
  const selection = { isEmpty: false, anchor: 0, active: 3 };
  h.vscode.window.activeTextEditor = { document: old, selection };
  h.vscode.window.tabGroups = {
    activeTabGroup: { activeTab: { input: { uri: active.uri } } },
  };
  let submitted;
  const secondary = {
    insertLinkedCode: async (uri, options) => {
      submitted = { uri, options };
      return null;
    },
  };
  const result = await h.linkSelectionToNote(secondary, {
    activeSourceSelection: async () => ({ document: active, selection }),
  });
  assert.equal(result, false);
  assert.equal(submitted.uri.path, "/workspace/active.note.md");
  assert.equal(submitted.options.selectedText, "current");
  assert.equal(h.saved.length, 0);
  assert.equal(h.files.has(submitted.uri.path), false);
});

test("AI artifact for a dotted folder resolves its append-only folder note", async () => {
  const h = harness();
  const owner = h.addFile("docs.v2");
  h.files.set(owner.path, { type: 2 });
  const document = h.documentFor(h.addFile("docs.v2.ai.md", "selected"));
  h.vscode.window.activeTextEditor = {
    document,
    selection: { isEmpty: false, anchor: 0, active: 3 },
  };
  let target;
  await h.linkSelectionToNote({
    insertLinkedCode: async (uri, options) => {
      target = { uri, options };
      return { created: true };
    },
  });
  assert.equal(target.uri.path, "/workspace/docs.v2.note.md");
  assert.equal(target.options.sourceUri.path, owner.path);
  assert.equal(h.saved.length, 0);
});

test("sidebar selection inserts through the current client without any host writer", async () => {
  const h = harness();
  const { pane, uri } = await auditSidebar(h);
  pane.ready = true;
  pane.openNow = async () => false;
  assert.equal(await pane.insertLinkedCode(uri, {}), null);
  assert.equal(
    pane.view.messages.some((message) => message.type === "linkedCode.insert"),
    false,
  );
  pane.openNow = async () => true;
  pane.view.onPost = (message) => {
    if (message.type === "linkedCode.insert")
      return pane
        .onMessage({
          type: "linkedCode.result",
          requestId: message.requestId,
          accepted: true,
          created: true,
        })
        .then(() => true);
  };
  assert.equal(
    (
      await pane.insertLinkedCode(uri, {
        reference: {},
        selectedText: "source",
      })
    ).created,
    true,
  );
  assert.equal(pane.insertionWaiters.size, 0);
  assert.equal(h.files.get(uri.path).text, "base");
  assert.equal(h.saved.length, 0);
  pane.dispose();
});

test("exclusive note creation refuses an intervening file without overwriting it", async () => {
  const h = harness();
  const uri = h.addFile("raced.note.md", "other writer");
  assert.equal(
    await h.createNoteDocument(uri, "my draft", () => true),
    undefined,
  );
  assert.equal(h.files.get(uri.path).text, "other writer");
  h.files.delete(uri.path);
  const document = await h.createNoteDocument(uri, "my draft", () => true);
  assert.equal(document.getText(), "my draft");
  assert.equal(document.isDirty, true);
  assert.equal(h.saved.length, 0);
});

test("closing and resolving sidebar views does not retain retired registrations", async () => {
  const h = harness();
  const pane = new h.SecondaryNotePane(h.context, h.ownership);
  for (let index = 0; index < 200; index++) {
    const panel = h.panel();
    let close;
    panel.onDidDispose = (callback) => {
      close = callback;
      return { dispose() {} };
    };
    await pane.resolveWebviewView(panel);
    close();
    assert.equal(pane.scope.resources.size, 0);
    assert.equal(pane.view, undefined);
  }
  pane.dispose();
});

test("permanent-delete fallback rechecks permission after its own confirmation", async () => {
  const h = harness();
  const uri = h.addFile("file.note.md", "base");
  let allowed = true,
    calls = 0;
  h.vscode.workspace.fs.delete = async () => {
    calls++;
    throw Error("Trash unavailable");
  };
  h.vscode.window.showWarningMessage = async () => {
    allowed = false;
    return "Delete Permanently";
  };
  assert.equal(
    await h.trashNotesLocally([uri], { beforeDelete: () => allowed }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(h.files.get(uri.path).text, "base");
});

test("typing queued immediately after main Ctrl+S survives the save barrier and remains dirty", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  let pendingEdit;
  panel.onPost = (message) => {
    if (message.type !== "editing.probe") return;
    pendingEdit = panel.send({
      type: "edit",
      generation: 0,
      lease,
      changes: [{ from: 4, to: 4, insert: " typed after save" }],
    });
    panel.send({
      type: "editing.snapshot",
      requestId: message.requestId,
      text: "body typed after save",
      dirty: false,
    });
  };
  await panel.send({ type: "save", lease });
  await pendingEdit;
  assert.deepEqual(h.saved, ["body"]);
  assert.equal(document.getText(), "body typed after save");
  assert.equal(document.isDirty, true);
  assert.equal(
    panel.messages.some(({ type }) => type === "reset" || type === "external"),
    false,
  );
  provider.dispose();
});

test("main stays paused throughout metadata IO even if ownership notifies again", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: document.getText(),
        dirty: false,
      });
  };
  const entered = deferred();
  const resume = deferred();
  const stat = h.vscode.workspace.fs.stat;
  h.vscode.workspace.fs.stat = async (resource) => {
    entered.resolve();
    await resume.promise;
    return stat(resource);
  };
  const saving = panel.send({ type: "save", lease });
  await entered.promise;
  h.ownership.notify();
  assert.equal(
    panel.messages.filter(({ type }) => type === "editingState").at(-1)
      .readOnly,
    true,
  );
  resume.resolve();
  await saving;
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.equal(document.isDirty, false);
  assert.equal(
    panel.messages.filter(({ type }) => type === "editingState").at(-1)
      .readOnly,
    false,
  );
  provider.dispose();
});

test("an unavailable main snapshot skips stamping without dropping queued input", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  panel.onPost = (message) => message.type !== "editing.probe";
  const saving = panel.send({ type: "save", lease });
  const editing = panel.send({
    type: "edit",
    generation: 0,
    lease,
    changes: [{ from: 4, to: 4, insert: " still here" }],
  });
  await Promise.all([saving, editing]);
  assert.equal(document.getText(), "body still here");
  assert.deepEqual(h.saved, ["body"]);
  assert.equal(document.isDirty, true);
  assert.equal(
    panel.messages.some(({ type }) => type === "reset"),
    false,
  );
  provider.dispose();
});

test("native Save cannot return a delayed metadata replacement after resuming webview input", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  let clientText = document.getText();
  let generation = 0;
  let pendingEdit;
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: clientText,
        dirty: false,
      });
    if (message.type === "external") {
      for (const change of [...message.changes].reverse())
        clientText =
          clientText.slice(0, change.from) +
          change.insert +
          clientText.slice(change.to);
      generation = message.generation;
    }
    if (message.type === "editingState" && !message.readOnly && !pendingEdit) {
      pendingEdit = {
        type: "edit",
        generation,
        lease,
        changes: [
          {
            from: clientText.length,
            to: clientText.length,
            insert: " typed after native barrier",
          },
        ],
      };
      clientText += " typed after native barrier";
    }
  };
  const promises = [];
  for (const listener of h.willSaveListeners)
    listener({
      document,
      reason: h.vscode.TextDocumentSaveReason.Manual,
      waitUntil: (promise) => promises.push(promise),
    });
  for (const edits of await Promise.all(promises))
    for (const edit of edits)
      document.replace(edit.range.from, edit.range.to, edit.newText);
  assert.ok(pendingEdit, "the native save barrier must release the client");
  await panel.send(pendingEdit);
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.match(document.getText(), /body typed after native barrier$/u);
  assert.equal(
    panel.messages.some(({ type }) => type === "reset"),
    false,
  );
  provider.dispose();
});

test("native Save holds its pause through metadata application despite ownership notifications", async () => {
  const h = harness();
  const { document, provider, panel } = await mainEditor(h);
  panel.onPost = (message) => {
    if (message.type === "editing.probe")
      panel.send({
        type: "editing.snapshot",
        requestId: message.requestId,
        text: document.getText(),
        dirty: false,
      });
  };
  const entered = deferred();
  const resume = deferred();
  const stat = h.vscode.workspace.fs.stat;
  h.vscode.workspace.fs.stat = async (resource) => {
    entered.resolve();
    await resume.promise;
    return stat(resource);
  };
  const saving = nativeSaveEdits(h, document);
  await entered.promise;
  h.ownership.notify();
  assert.equal(
    panel.messages.filter(({ type }) => type === "editingState").at(-1)
      .readOnly,
    true,
  );
  resume.resolve();
  const prepared = await saving;
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0].length, 0);
  assert.match(document.getText(), /file: file\.note\.md/u);
  assert.equal(
    panel.messages.filter(({ type }) => type === "editingState").at(-1)
      .readOnly,
    false,
  );
  provider.dispose();
});

for (const failure of ["reject", "false", "timeout"]) {
  test(`native metadata ${failure} releases the client and cannot apply a late replacement`, async () => {
    const h = harness();
    const { document, provider, panel, lease } = await mainEditor(h);
    panel.onPost = (message) => {
      if (message.type === "editing.probe")
        panel.send({
          type: "editing.snapshot",
          requestId: message.requestId,
          text: document.getText(),
          dirty: false,
        });
    };
    const delayedStat = deferred();
    const applyEdit = h.vscode.workspace.applyEdit;
    if (failure === "timeout")
      h.vscode.workspace.fs.stat = () => delayedStat.promise;
    else
      h.vscode.workspace.applyEdit = async () => {
        if (failure === "reject") throw new Error("metadata edit failed");
        return false;
      };
    const prepared = await nativeSaveEdits(h, document);
    assert.equal(prepared[0].length, 0);
    assert.equal(document.getText(), "body");
    assert.equal(
      panel.messages.filter(({ type }) => type === "editingState").at(-1)
        .readOnly,
      false,
    );
    delayedStat.resolve({ ctime: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      document.getText(),
      "body",
      "late metadata cannot mutate the note",
    );
    h.vscode.workspace.applyEdit = applyEdit;
    await panel.send({
      type: "edit",
      generation: 0,
      lease,
      changes: [{ from: 4, to: 4, insert: " editable" }],
    });
    assert.equal(document.getText(), "body editable");
    provider.dispose();
  });
}

async function sidebar(h) {
  const first = h.addFile("first.note.md", "first");
  const second = h.addFile("second.note.md", "second");
  const source = h.addFile("second.js", "source");
  const pane = new h.SecondaryNotePane(h.context, h.ownership);
  const messages = [];
  pane.documentUri = first;
  pane.document = h.documentFor(first);
  pane.ready = true;
  pane.view = {
    webview: {
      postMessage: async (message) => {
        messages.push(message);
        if (message.type === "editing.probe")
          void pane.onMessage({
            type: "editing.snapshot",
            requestId: message.requestId,
            text: pane.document.getText(),
            dirty: false,
            ...pane.testSnapshot,
          });
        return true;
      },
    },
  };
  pane.sendInit = async () => {
    pane.draftDirty = false;
    messages.push({ type: "init", relativePath: pane.editingPath() });
  };
  pane.focus = async () => undefined;
  await h.ownership.activate(pane.editSurface);
  return { pane, first, second, source, messages };
}

for (const route of ["open", "follow"]) {
  test(`sidebar ${route} stages IO without replacing a draft-state update received during lookup`, async () => {
    const h = harness();
    const { pane, first, second, source, messages } = await sidebar(h);
    const entered = deferred();
    const resume = deferred();
    const stat = h.vscode.workspace.fs.stat;
    let paused = false;
    h.vscode.workspace.fs.stat = async (resource) => {
      if (!paused && resource.path === second.path) {
        paused = true;
        entered.resolve();
        await resume.promise;
      }
      return stat(resource);
    };
    const navigation =
      route === "open"
        ? pane.open(second, { sourceUri: source, reveal: false })
        : pane.followTarget(source);
    await entered.promise;
    await pane.onMessage({
      type: "draft.state",
      relativePath: "first.note.md",
      dirty: true,
      pending: false,
    });
    h.ownership.notify();
    assert.equal(
      messages.filter(({ type }) => type === "editingState").at(-1).readOnly,
      true,
    );
    resume.resolve();
    assert.equal(await navigation, false);
    assert.equal(pane.documentUri.toString(), first.toString());
    assert.equal(pane.draftDirty, true);
    assert.equal(
      messages.some(({ type }) => type === "init"),
      false,
    );
    assert.equal(
      messages.filter(({ type }) => type === "editingState").at(-1).readOnly,
      false,
    );
    pane.dispose();
  });
}

test("a dirty optimistic sidebar snapshot prevents navigation before any destination lookup", async () => {
  const h = harness();
  const { pane, first, second, source, messages } = await sidebar(h);
  pane.testSnapshot = { text: "first plus local draft", dirty: true };
  let reads = 0;
  h.vscode.workspace.fs.stat = async () => {
    reads++;
    throw new Error("destination should not be read");
  };
  assert.equal(
    await pane.open(second, { sourceUri: source, reveal: false }),
    false,
  );
  assert.equal(reads, 0);
  assert.equal(pane.documentUri.toString(), first.toString());
  assert.equal(
    messages.some(({ type }) => type === "init"),
    false,
  );
  pane.dispose();
});

test("a failed staged sidebar lookup leaves the previous note and source untouched", async () => {
  const h = harness();
  const { pane, first, second, source, messages } = await sidebar(h);
  const previousSource = h.addFile("first.js");
  pane.sourceUri = previousSource;
  h.vscode.workspace.openTextDocument = async () => {
    throw new Error("cannot open destination");
  };
  await assert.rejects(
    pane.open(second, { sourceUri: source, reveal: false }),
    /cannot open destination/u,
  );
  assert.equal(pane.documentUri.toString(), first.toString());
  assert.equal(pane.sourceUri.toString(), previousSource.toString());
  assert.equal(
    messages.some(({ type }) => type === "init"),
    false,
  );
  assert.equal(pane.navigationPaused, false);
  pane.dispose();
});

test("a clean staged sidebar transition resumes the new note without saving either note", async () => {
  const h = harness();
  const { pane, second, source, messages } = await sidebar(h);
  assert.equal(
    await pane.open(second, { sourceUri: source, reveal: false }),
    true,
  );
  assert.equal(pane.documentUri.toString(), second.toString());
  assert.equal(pane.sourceUri.toString(), source.toString());
  assert.equal(messages.filter(({ type }) => type === "init").length, 1);
  assert.deepEqual(h.saved, []);
  assert.equal(pane.navigationPaused, false);
  pane.dispose();
});
