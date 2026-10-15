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
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js"; export {createNoteDocument} from "./src/notes/operation.js";',
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
  // A second root with its own project note: the only cross-note navigation left.
  const other = { name: "other", uri: uri("/other") };
  const folderOf = (resource) =>
    [folder, other].find((entry) =>
      `${resource.path}/`.startsWith(`${entry.uri.path}/`),
    );
  const files = new Map([
    [folder.uri.path, { type: 2 }],
    [other.uri.path, { type: 2 }],
  ]);
  const documents = new Map();
  const changeListeners = new Set();
  const willSaveListeners = new Set();
  const saved = [];
  const errors = [];
  const disposable = () => ({ dispose() {} });
  const addFile = (name, text = "body", root = folder) => {
    const resource = uri(`${root.uri.path}/${name}`);
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
      getWorkspaceFolder: (resource) => folderOf(resource),
      workspaceFolders: [folder, other],
      asRelativePath: (resource) =>
        resource.path.replace(/^\/(?:workspace|other)\/?/u, ""),
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
    crypto,
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
    other,
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
  const resource = h.addFile("workspace.note.md", "body");
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

async function auditSidebar(h) {
  const uri = h.addFile("workspace.note.md", "base");
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
    const next = h.addFile("other.note.md", "next", h.other);
    pane.focus = async () => {};
    pane.activeMainResource = () => h.addFile("next.js", "code", h.other);
    const originalSave = document.save;
    document.save = async () => (saved ? originalSave() : false);
    pane.view.onPost = (message) => {
      if (message.type === "draft.saveRequest") {
        void pane
          .commitDraft("base LOCAL", pane.generation, 71, "workspace.note.md", lease)
          .then((result) =>
            pane.onMessage({
              type: "draft.saveResult",
              requestId: message.requestId,
              relativePath: "workspace.note.md",
              saved: Boolean(result.saved),
            }),
          );
      } else if (message.type === "editing.probe") {
        void pane.onMessage({
          type: "editing.snapshot",
          requestId: message.requestId,
          text: document.getText(),
          dirty: false,
        });
      }
      return true;
    };
    assert.equal(await pane.followActive(), saved);
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
  pane.view.onPost = (message) => {
    request = message;
    return true;
  };
  const flush = pane.flushDraftBeforeNavigation();
  pane.draftDirty = false;
  await pane.onMessage({
    type: "draft.state",
    relativePath: "workspace.note.md",
    dirty: true,
    pending: false,
  });
  await pane.onMessage({
    type: "draft.saveResult",
    requestId: request.requestId,
    relativePath: "workspace.note.md",
    saved: true,
  });
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
  const commit = pane.commitDraft("base LOCAL", 0, 1, "workspace.note.md", lease);
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
  const commit = pane.commitDraft("obsolete", 0, 1, "workspace.note.md", lease);
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
    relativePath: "workspace.note.md",
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

test("main save preserves exact source and a later edit remains dirty", async () => {
  const h = harness();
  const { document, provider, panel, lease } = await mainEditor(h);
  await panel.send({ type: "save", lease });
  assert.deepEqual(h.saved, ["body"]);
  assert.equal(document.getText(), "body");
  await panel.send({
    type: "edit",
    generation: 0,
    lease,
    changes: [{ from: 4, to: 4, insert: " still here" }],
  });
  assert.equal(document.getText(), "body still here");
  assert.equal(document.isDirty, true);
  assert.equal(
    panel.messages.some(({ type }) => type === "reset" || type === "external"),
    false,
  );
  provider.dispose();
});

async function sidebar(h) {
  const first = h.addFile("workspace.note.md", "first");
  const second = h.addFile("other.note.md", "second", h.other);
  const source = h.addFile("second.js", "source", h.other);
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

for (const route of ["follow"]) {
  test(`sidebar ${route} stages IO without replacing a draft-state update received during lookup`, async () => {
    const h = harness();
    const { pane, first, second, source, messages } = await sidebar(h);
    pane.activeMainResource = () => source;
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
    const navigation = pane.followActive();
    await entered.promise;
    await pane.onMessage({
      type: "draft.state",
      relativePath: "workspace.note.md",
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
