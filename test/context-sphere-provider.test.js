import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents: 'export { ContextSphereProvider } from "./src/context/sphere-provider.js"; export { ContextSphereGraph } from "./src/context/sphere-graph.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

class Uri {
  constructor(value) {
    this.url = new URL(value);
    this.scheme = this.url.protocol.slice(0, -1);
    this.authority = this.url.host;
    this.path = decodeURIComponent(this.url.pathname);
  }
  toString() { return this.url.href; }
  with({ path: nextPath = this.path, fragment = "", query = "" }) {
    const value = new URL(this.url);
    value.pathname = nextPath;
    value.hash = fragment;
    value.search = query;
    return new Uri(value.href);
  }
  static parse(value) { return new Uri(value); }
  static joinPath(uri, ...parts) { return uri.with({ path: path.posix.join(uri.path, ...parts) }); }
}

function harness() {
  const uri = (name) => Uri.parse(`file:///project/${name}`);
  const folder = { name: "project", uri: uri("") };
  const file = uri("a.md");
  const files = new Map([[file.path, "Hello"]]);
  const opened = [], persisted = [], live = new Set(), watchers = [];
  const subscribe = (listeners) => (listener) => {
    listeners.add(listener);
    const resource = { dispose() { listeners.delete(listener); live.delete(resource); } };
    live.add(resource);
    return resource;
  };
  const globalEvents = {
    active: new Set(), tabs: new Set(), groups: new Set(), folders: new Set(),
    trust: new Set(), extension: new Set(), save: new Set(), change: new Set(), close: new Set(),
  };
  const vscode = {
    Uri,
    FileType: { File: 1 },
    window: {
      tabGroups: {
        all: [{ tabs: [{ input: { uri: file } }] }],
        activeTabGroup: { activeTab: { input: { uri: file } } },
        onDidChangeTabs: subscribe(globalEvents.tabs),
        onDidChangeTabGroups: subscribe(globalEvents.groups),
      },
      onDidChangeActiveTextEditor: subscribe(globalEvents.active),
      registerWebviewViewProvider: () => {
        const registration = { dispose() { live.delete(registration); } };
        live.add(registration);
        return registration;
      },
      showWarningMessage: () => undefined,
    },
    workspace: {
      isTrusted: true,
      textDocuments: [],
      getWorkspaceFolder: (resource) => resource?.path.startsWith("/project/") ? folder : undefined,
      fs: {
        stat: async (resource) => {
          if (!files.has(resource.path)) throw new Error("missing");
          return { type: 1, mtime: 1, size: files.get(resource.path).length };
        },
        readFile: async (resource) => new TextEncoder().encode(files.get(resource.path)),
      },
      onDidChangeWorkspaceFolders: subscribe(globalEvents.folders),
      onDidGrantWorkspaceTrust: subscribe(globalEvents.trust),
      onDidSaveTextDocument: subscribe(globalEvents.save),
      onDidChangeTextDocument: subscribe(globalEvents.change),
      onDidCloseTextDocument: subscribe(globalEvents.close),
      createFileSystemWatcher: () => {
        const events = { create: new Set(), change: new Set(), delete: new Set() };
        const watcher = {
          disposed: false,
          onDidCreate: subscribe(events.create),
          onDidChange: subscribe(events.change),
          onDidDelete: subscribe(events.delete),
          dispose() { watcher.disposed = true; live.delete(watcher); },
        };
        watchers.push(watcher);
        live.add(watcher);
        return watcher;
      },
    },
    extensions: { getExtension: () => undefined, onDidChange: subscribe(globalEvents.extension) },
    commands: { executeCommand: async (...args) => { opened.push(args); } },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports,
    require: (name) => name === "vscode" ? vscode : require(name),
    URL, TextEncoder, TextDecoder, Buffer, process, console, setTimeout, clearTimeout,
  });
  const context = {
    extensionUri: uri("../extension"),
    workspaceState: { get: () => [], update: async (key, value) => persisted.push({ key, value }) },
    subscriptions: [],
  };
  function view() {
    const messages = [], receives = new Set(), visibility = new Set(), disposal = new Set();
    return {
      visible: true,
      messages,
      webview: {
        cspSource: "test",
        asWebviewUri: (value) => value.toString(),
        postMessage: async (message) => { messages.push(message); return true; },
        onDidReceiveMessage: subscribe(receives),
      },
      onDidChangeVisibility: subscribe(visibility),
      onDidDispose: subscribe(disposal),
      send: async (message) => { await Promise.all([...receives].map((listener) => listener(message))); },
      close: () => { for (const listener of [...disposal]) listener(); },
      listenerCount: () => receives.size + visibility.size + disposal.size,
    };
  }
  const provider = module.exports.ContextSphereProvider.register(context);
  const graph = () => [...provider.surface.resources].find((item) => item instanceof module.exports.ContextSphereGraph);
  const settle = async (surface) => {
    for (let i = 0; i < 20; i++) {
      if (surface.messages.some((message) => message.type === "graph" && message.graph.nodes.length)) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail("sphere graph did not publish a populated snapshot");
  };
  return { provider, graph, view, settle, opened, persisted, live, watchers, file };
}

test("ready publishes a snapshot and only current graph IDs may open or pin", async () => {
  const h = harness();
  const surface = h.view();
  h.provider.resolveWebviewView(surface);
  await surface.send({ type: "ready" });
  assert.equal(surface.messages[0].type, "graph");
  await h.settle(surface);
  const current = surface.messages.at(-1).graph;
  assert.equal(current.nodes.length, 1);
  await surface.send({ type: "open", id: "file:///project/ghost.md" });
  await surface.send({ type: "pin", id: "file:///project/ghost.md", pinned: true });
  assert.equal(h.opened.length, 0);
  assert.equal(h.persisted.length, 0);
  await surface.send({ type: "open", id: current.nodes[0].id });
  assert.equal(h.opened[0][0], "vscode.open");
  assert.equal(h.opened[0][1].toString(), h.file.toString());
  assert.equal(h.persisted.length, 0, "opening a node must not pin it");
  await surface.send({ type: "pin", id: current.nodes[0].id, pinned: true });
  assert.equal(h.persisted.length, 1);
  h.provider.dispose();
});

test("replacing and disposing a sphere view retires its graph, listeners and commands", async () => {
  const h = harness();
  const first = h.view();
  h.provider.resolveWebviewView(first);
  await first.send({ type: "ready" });
  await h.settle(first);
  const oldGraph = h.graph();
  const oldId = first.messages.at(-1).graph.nodes[0].id;
  const second = h.view();
  h.provider.resolveWebviewView(second);
  assert.equal(oldGraph.disposed, true);
  assert.equal(first.listenerCount(), 0);
  const oldCount = first.messages.length;
  await first.send({ type: "open", id: oldId });
  assert.equal(h.opened.length, 0);
  assert.equal(first.messages.length, oldCount);
  await second.send({ type: "ready" });
  await h.settle(second);
  const newGraph = h.graph();
  assert.notEqual(newGraph, oldGraph);
  h.provider.dispose();
  assert.equal(newGraph.disposed, true);
  assert.equal(second.listenerCount(), 0);
  assert.equal(h.live.size, 0);
  assert.ok(h.watchers.every((watcher) => watcher.disposed));
  await second.send({ type: "open", id: oldId });
  assert.equal(h.opened.length, 0);
});

test("closing the webview retires its graph without retaining the old surface", async () => {
  const h = harness();
  const surface = h.view();
  h.provider.resolveWebviewView(surface);
  await surface.send({ type: "ready" });
  await h.settle(surface);
  const graph = h.graph();
  surface.close();
  assert.equal(graph.disposed, true);
  assert.equal(h.provider.surface, undefined);
  assert.equal(surface.listenerCount(), 0);
  h.provider.dispose();
  assert.equal(h.live.size, 0);
});
