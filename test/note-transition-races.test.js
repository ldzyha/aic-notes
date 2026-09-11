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
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js";',
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
      isDirty: false,
      getText: () => text,
      positionAt: (offset) => offset,
      save: async () => {
        saved.push(text);
        files.get(resource.path).text = text;
        document.isDirty = false;
        return true;
      },
      replace: (from, to, insert) => {
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
    TextDocumentSaveReason: { Manual: 1 },
    TextEdit: { replace: (range, newText) => ({ range, newText }) },
    Range: class {
      constructor(from, to) {
        Object.assign(this, { from, to });
      }
    },
    WorkspaceEdit: class {
      edits = [];
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
