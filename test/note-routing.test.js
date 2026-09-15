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
      'export {SecondaryNotePane} from "./src/secondary/provider.js"; export {MarkdownEditorProvider} from "./src/editor/provider.js"; export {openNoteDocument} from "./src/notes/create.js"; export {NoteEditOwnership} from "./src/notes/edit-ownership.js"; export {parentNoteCandidates} from "./src/notes/parent-context.js"; export {workspaceLinkUri} from "./src/notes/navigation.js";',
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
    RelativePattern: class {
      constructor(base, pattern) {
        this.base = base;
        this.pattern = pattern;
      }
    },
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
  const note = h.addFile("source.note.md", "note");
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
  h.pane.placeholderUri = note;
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
  assert.ok(
    h.sent.some(
      (value) =>
        typeof value === "string" && /^(?:Unsaved|Save failed)/u.test(value),
    ),
  );
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
  assert.equal(await pending, true);
  assert.equal(h.pane.placeholderUri.path, "/workspace/workspace.note.md");
  assert.equal(h.pane.sourceUri.path, "/workspace");
  assert.deepEqual(h.events.opened, []);
});

test("main note follows its nearest existing parent without opening or saving its source", async () => {
  const h = harness(true);
  h.addFile("src", undefined, 2);
  h.addFile("src/component", undefined, 2);
  const parent = h.addFile("src/component.note.md");
  h.addFile("src.note.md");
  h.addFile("workspace.note.md");
  const note = h.addFile("src/component/file.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { uri: note } };
  // A dirty main document is independent of its parent note, and remains dirty.
  const document = h.getDocument(note);
  document.replace(0, 0, "main draft ");
  assert.equal(await h.pane.followActive(), true);
  assert.equal(h.pane.documentUri.path, parent.path);
  assert.equal(h.pane.sourceUri.path, "/workspace/src/component");
  assert.equal(document.isDirty, true);
  assert.deepEqual(h.commands, []);
  assert.deepEqual(h.events.closed, []);
  assert.deepEqual(h.events.writes, []);
  assert.deepEqual(h.events.saved, []);
  assert.deepEqual(h.events.opened, [parent.path]);
});

test("folder sidecars skip themselves and folders without notes", async () => {
  const h = harness();
  h.addFile("src", undefined, 2);
  h.addFile("src/gap", undefined, 2);
  h.addFile("src/gap/component", undefined, 2);
  const parent = h.addFile("src.note.md");
  const note = h.addFile("src/gap/component.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { uri: note } };
  await h.pane.followActive();
  assert.equal(h.pane.documentUri.path, parent.path);
  assert.deepEqual(h.events.writes, []);
});

test("orphan notes and ambiguous sources use containing context, not reverse source resolution", async () => {
  const h = harness();
  h.addFile("docs.v2", undefined, 2);
  const parent = h.addFile("docs.v2.note.md");
  h.addFile("docs.v2/same.js");
  h.addFile("docs.v2/same.ts");
  for (const name of ["docs.v2/same.note.md", "docs.v2/orphan.note.md"]) {
    const note = h.addFile(name);
    h.vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: { modified: note },
    };
    await h.pane.followActive();
    assert.equal(h.pane.documentUri.path, parent.path);
  }
  assert.deepEqual(h.events.errors, []);
  assert.deepEqual(h.commands, []);
});

test("native note editor follows the project and project fallback remains stable when already open", async () => {
  const h = harness(true);
  const project = h.addFile("workspace.note.md");
  const note = h.addFile("root.note.md");
  h.vscode.window.activeTextEditor = { document: h.getDocument(note) };
  await h.pane.followActive();
  assert.equal(h.pane.documentUri.path, project.path);
  const generation = h.pane.generation;
  h.sent.length = 0;
  h.vscode.window.activeTextEditor.document = h.getDocument(project);
  await h.pane.followActive();
  assert.equal(h.pane.documentUri.path, project.path);
  assert.equal(h.pane.generation, generation);
  assert.equal(h.sent.includes("init"), false);
  assert.deepEqual(h.events.saved, []);
});

test("pinned notes do not follow a main note", async () => {
  const h = harness();
  const old = h.addFile("pinned.note.md");
  h.pane.documentUri = old;
  h.pane.pinned = true;
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: h.addFile("other.note.md") },
  };
  assert.equal(await h.pane.followActive(), false);
  assert.equal(h.pane.documentUri, old);
  assert.deepEqual(h.events.opened, []);
});

test("created and deleted parent notes dynamically update main-note context without writes", async () => {
  const h = harness();
  h.addFile("src", undefined, 2);
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: h.addFile("src/file.note.md") },
  };
  await h.pane.followActive();
  assert.equal(h.pane.placeholderUri.path, "/workspace/workspace.note.md");
  const parent = h.addFile("src.note.md");
  await h.pane.onNotesChanged();
  assert.equal(h.pane.documentUri.path, parent.path);
  const generation = h.pane.generation;
  h.sent.length = 0;
  await h.pane.onNotesChanged();
  assert.equal(h.pane.generation, generation);
  assert.equal(h.sent.includes("init"), false);
  h.files.delete(parent.path);
  await h.pane.onNotesChanged();
  assert.equal(h.pane.placeholderUri.path, "/workspace/workspace.note.md");
  assert.deepEqual(h.events.writes, []);
});

test("active tab and pin changes during ancestor lookup cancel obsolete navigation", async () => {
  for (const change of ["tab", "pin"]) {
    const h = harness();
    h.addFile("src", undefined, 2);
    h.addFile("src.note.md");
    const note = h.addFile("src/file.note.md");
    const other = h.addFile("other.js");
    h.vscode.window.tabGroups.activeTabGroup.activeTab = {
      input: { uri: note },
    };
    const originalStat = h.vscode.workspace.fs.stat;
    let release;
    h.vscode.workspace.fs.stat = (resource) =>
      resource.path === "/workspace/src.note.md"
        ? new Promise((resolve) => {
            release = async () => resolve(await originalStat(resource));
          })
        : originalStat(resource);
    const pending = h.pane.followActive();
    await new Promise((resolve) => setImmediate(resolve));
    if (change === "pin") h.pane.pinned = true;
    else
      h.vscode.window.tabGroups.activeTabGroup.activeTab = {
        input: { uri: other },
      };
    await release();
    assert.equal(await pending, false);
    assert.equal(h.pane.documentUri, undefined);
    assert.deepEqual(h.events.opened, []);
    assert.equal(h.sent.includes("init"), false);
  }
});

test("an ancestor removed while staging falls through to the project, never its placeholder", async () => {
  const h = harness();
  h.addFile("src", undefined, 2);
  h.addFile("src.note.md");
  const project = h.addFile("workspace.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: h.addFile("src/file.note.md") },
  };
  const stage = h.pane.stageNote.bind(h.pane);
  h.pane.stageNote = async (...args) => {
    if (args[0].path === "/workspace/src.note.md") h.files.delete(args[0].path);
    return stage(...args);
  };
  await h.pane.followActive();
  assert.equal(h.pane.documentUri.path, project.path);
  assert.equal(h.pane.placeholderUri, undefined);
  assert.deepEqual(h.events.writes, []);
});

test("an ancestor removed after stat but before document open falls through safely", async () => {
  const h = harness();
  h.addFile("src", undefined, 2);
  h.addFile("src.note.md");
  const project = h.addFile("workspace.note.md");
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: h.addFile("src/file.note.md") },
  };
  const open = h.vscode.workspace.openTextDocument;
  h.vscode.workspace.openTextDocument = (resource) => {
    if (resource.path === "/workspace/src.note.md")
      h.files.delete(resource.path);
    return open(resource);
  };
  assert.equal(await h.pane.followActive(), true);
  assert.equal(h.pane.documentUri.path, project.path);
  assert.equal(h.pane.navigationPaused, false);
  assert.deepEqual(h.events.writes, []);
});

test("the project placeholder is stable across repeated main-note events", async () => {
  const h = harness();
  h.vscode.window.tabGroups.activeTabGroup.activeTab = {
    input: { uri: h.addFile("file.note.md") },
  };
  await h.pane.followActive();
  const generation = h.pane.generation,
    text = h.pane.placeholderText;
  h.sent.length = 0;
  await h.pane.followActive();
  assert.equal(h.pane.generation, generation);
  assert.equal(h.pane.placeholderText, text);
  assert.equal(h.sent.includes("init"), false);
});

test("nearest-note scope stops at the owning nested workspace, uses its name, and normalizes Windows paths", async () => {
  const h = harness();
  const nested = { name: "Nested Alias", uri: h.uri("/workspace/inner") };
  h.addFile("inner", undefined, 2);
  h.addFile("inner/src", undefined, 2);
  h.addFile("inner.note.md");
  h.addFile("workspace.note.md");
  const note = h.addFile("inner/src/file.note.md");
  h.vscode.workspace.getWorkspaceFolder = (resource) =>
    resource.path.startsWith("/workspace/inner/") ||
    resource.path === nested.uri.path
      ? nested
      : undefined;
  h.vscode.workspace.asRelativePath = (resource) =>
    resource.path.slice(nested.uri.path.length + 1).replaceAll("/", "\\");
  const candidates = [];
  for await (const value of h.parentNoteCandidates(note))
    candidates.push(value.noteUri.path);
  assert.deepEqual(candidates, ["/workspace/inner/Nested Alias.note.md"]);
  const outside = [];
  for await (const value of h.parentNoteCandidates(h.uri("/outside/a.note.md")))
    outside.push(value);
  assert.deepEqual(outside, []);
});

test("project identity wins over a same-named folder; note-suffixed folders are skipped", async () => {
  const h = harness();
  h.addFile("workspace", undefined, 2);
  h.addFile("odd.note.md", undefined, 2);
  const project = h.addFile("workspace.note.md");
  for (const name of ["workspace/file.note.md", "odd.note.md/file.note.md"]) {
    const note = h.addFile(name);
    const candidates = [];
    for await (const value of h.parentNoteCandidates(note))
      candidates.push(value);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].noteUri.path, project.path);
    assert.equal(candidates[0].targetUri.path, "/workspace");
    assert.equal(candidates[0].isProject, true);
  }
});

test("late relationship results cannot overwrite the next note context", async () => {
  const h = harness();
  h.pane.documentUri = h.addFile("workspace.note.md");
  h.pane.sourceUri = h.uri("/workspace");
  h.pane.ready = true;
  let finish;
  h.vscode.workspace.findFiles = () =>
    new Promise((resolve) => {
      finish = () => resolve([]);
    });
  const pending = h.pane.refreshRelationships();
  await new Promise((resolve) => setImmediate(resolve));
  h.pane.generation++;
  finish();
  await pending;
  assert.equal(
    h.sent.some((value) => value?.type === "relationships"),
    false,
  );
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
    assert.doesNotMatch(panel.webview.html, /id="document-source"/u);
    assert.equal(panel.messages[0].type, "init");
    assert.deepEqual(h.commands, []);
  }
  provider.dispose();
});

test("main-note edits stay in TextDocument until Ctrl+S", async () => {
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

test("manifest retains main/legacy editors and exposes source actions without a tree", async () => {
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
  for (const menu of ["editor/title", "explorer/context"])
    assert.ok(
      manifest.contributes.menus[menu].some(
        (entry) => entry.command === "aicNotes.openSource",
      ),
    );
  assert.equal(manifest.contributes.menus["view/item/context"], undefined);
  assert.equal(manifest.contributes.views.aicNotes, undefined);
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

test("clean native Save preserves exact source and unlocks a waiting sidebar", async () => {
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
  const document = h.getDocument(h.addFile("file.note.md", "base"));
  const provider = new h.MarkdownEditorProvider(h.context, h.ownership);
  const panel = h.panel();
  await provider.resolveCustomTextEditor(document, panel);
  await panel.send({ type: "ready" });
  assert.equal(h.willSaveListeners.size, 0);
  assert.equal(document.getText(), "base");
});
