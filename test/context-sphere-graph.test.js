import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ContextSphereGraph, importReferences } from "../src/context/sphere-graph.js";

class Uri {
  constructor(value) { this.url = new URL(value); this.scheme = this.url.protocol.slice(0, -1); this.path = decodeURIComponent(this.url.pathname); }
  toString() { return this.url.href; }
  with({ path: nextPath = this.path, fragment = "", query = "" }) {
    const url = new URL(this.url); url.pathname = nextPath; url.hash = fragment; url.search = query; return new Uri(url.href);
  }
  static parse(value) { return new Uri(value); }
  static joinPath(uri, ...parts) { return uri.with({ path: path.posix.join(uri.path, ...parts) }); }
}
const uri = name => new Uri(`file:///project/${name}`);
function harness({ files = {}, open = [], active = open[0], pinned = [], maxNodes, docs = [] } = {}) {
  const messages = [], writes = [];
  const folder = { name: "project", uri: uri("") };
  const storage = new Map([["aicNotes.contextSphere.pinned.v1", pinned]]);
  const vscode = {
    Uri,
    workspace: {
      textDocuments: docs,
      getWorkspaceFolder: uri => uri.path.startsWith("/project/") ? folder : undefined,
      fs: {
        stat: async uri => {
          if (!(uri.path in files)) throw new Error("missing");
          return { type: 1, mtime: 1, size: files[uri.path].length };
        },
        readFile: async uri => new TextEncoder().encode(files[uri.path]),
      },
    },
    window: { tabGroups: { all: [{ tabs: open.map(name => ({ input: { uri: uri(name) } })) }],
      activeTabGroup: { activeTab: active ? { input: { uri: uri(active) } } : undefined } } },
  };
  const graph = new ContextSphereGraph(vscode, {
    maxNodes,
    state: { get: (key, fallback) => storage.get(key) ?? fallback,
      update: async (key, value) => { storage.set(key, value); writes.push({ key, value }); } },
    onUpdate: snapshot => messages.push(snapshot),
  });
  return { graph, vscode, messages, writes, files };
}

test("sphere static imports use syntax, not strings, comments or member require", () => {
  const source = [
    "// import bad from './comment.js'",
    "const fake = \"require('./string.js')\";",
    "import x from './x.js'; export * from './e.js';",
    "const a = require('./a.js'); const b = import('./b.js');",
    "obj.require('./not-commonjs.js'); require(variable);",
  ].join("\n");
  const parsed = importReferences(source);
  assert.deepEqual(parsed.references.map(ref => ref.specifier), ["./x.js", "./e.js", "./a.js", "./b.js"]);
  assert.equal(parsed.partial, true);
  assert.equal(parsed.references[0].line, 2);
});

test("sphere stays present empty and deduplicates open, changed, pinned and note context", async () => {
  const h = harness({ open: ["src/a.ts", "src/a.ts", "src/a.note.md"],
    pinned: [uri("src/a.ts").toString()], files: {
      "/project/src/a.ts": "import x from './b';",
      "/project/src/b.ts": "export default 1;",
      "/project/src/a.note.md": "existing note",
      "/project/src.note.md": "existing parent",
      "/project/project.note.md": "existing project",
    } });
  h.graph.git = { repositories: [{ state: { indexChanges: [{ uri: uri("src/a.ts") }], workingTreeChanges: [], mergeChanges: [] } }] };
  const snapshot = await h.graph.refresh();
  assert.equal(new Set(snapshot.nodes.map(node => node.id)).size, snapshot.nodes.length);
  const source = snapshot.nodes.find(node => node.label === "a.ts");
  assert.equal(source.open && source.changed && source.pinned, true);
  assert.equal(snapshot.edges.filter(edge => edge.kind === "note").length, 3);
  assert.equal(snapshot.edges.filter(edge => edge.kind === "import").length, 1);
  assert.equal(snapshot.nodes.find(node => node.label === "b.ts").provisional, true);
  assert.equal(h.writes.length, 0);
  assert.deepEqual((await harness().graph.refresh()).nodes, []);
});

test("sphere notes/custom tabs remain active; opening a node never pins it", async () => {
  const h = harness({ open: ["a.note.md"], files: { "/project/a.note.md": "note" } });
  const snapshot = await h.graph.refresh();
  assert.equal(snapshot.activeId, h.graph.id(uri("a.note.md")));
  assert.equal(snapshot.nodes[0].kind, "note");
  assert.equal(h.graph.resolve(snapshot.activeId).path, "/project/a.note.md");
  assert.equal(h.graph.pinned.size, 0);
  await h.graph.pin(snapshot.activeId, true);
  assert.equal(h.writes.length, 1);
  await h.graph.pin("file:///outside/secret", true);
  assert.equal(h.writes.length, 1);
  h.vscode.window.tabGroups.all = [];
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: {} };
  h.vscode.window.activeTextEditor = { document: { uri: uri("a.note.md") } };
  assert.equal((await h.graph.refresh()).activeId, "");
});

test("malformed persisted pin state cannot prevent the sphere from opening", async () => {
  const h = harness({ pinned: { unexpected: "object" }, open: ["a.md"],
    files: { "/project/a.md": "hello" } });
  const snapshot = await h.graph.refresh();
  assert.equal(h.graph.pinned.size, 0);
  assert.equal(snapshot.nodes[0].label, "a.md");
  h.graph.dispose();
});

test("unresolved and dynamic imports are partial, unsupported files unavailable, bounded graph explicit", async () => {
  const h = harness({ open: ["a.ts", "b.json"], files: {
    "/project/a.ts": "import './missing'; import alias from '@app/alias'; import(name);",
    "/project/b.json": "{}",
  } });
  const snapshot = await h.graph.refresh();
  assert.equal(snapshot.nodes[0].analysis, "partial");
  assert.equal(snapshot.nodes[1].analysis, "unavailable");
  const limited = harness({ maxNodes: 1, open: ["a.ts", "b.ts"] });
  assert.equal((await limited.graph.refresh()).limited, true);
});

test("dirty notifications update badges without re-reading, layout membership or note writes", async () => {
  const doc = { uri: uri("a.ts"), version: 1, isDirty: false, getText: () => "const x = 1;" };
  const h = harness({ open: ["a.ts"], docs: [doc], files: { "/project/a.ts": "const x = 1;" } });
  await h.graph.refresh();
  h.vscode.workspace.fs.readFile = () => { throw new Error("must not read during input"); };
  const edges = h.graph.snapshot.edges;
  doc.isDirty = true;
  h.graph.reflectDirty();
  assert.equal(h.graph.snapshot.nodes[0].dirty, true);
  assert.equal(h.graph.snapshot.edges, edges);
  assert.equal(h.writes.length, 0);
});

test("late disk read cannot repopulate a disposed graph cache", async () => {
  const h = harness({ open: ["a.ts"], files: { "/project/a.ts": "const a=1;" } });
  let unblock, started;
  const entered = new Promise(resolve => { started = resolve; });
  h.vscode.workspace.fs.readFile = async () => { started(); return new Promise(resolve => { unblock = resolve; }); };
  const refresh = h.graph.refresh();
  await entered;
  h.graph.dispose();
  unblock(new TextEncoder().encode("import './b'"));
  await refresh;
  assert.equal(h.graph.cache.size, 0);
  assert.equal(h.messages.length, 0);
});

test("reopened document with reused version gets its own import cache identity", async () => {
  const doc = source => ({ uri: uri("a.ts"), version: 1, getText: () => source });
  const h = harness({ open: ["a.ts"], docs: [doc("import './b'")], files: {
    "/project/a.ts": "", "/project/b.ts": "", "/project/c.ts": "",
  } });
  assert.ok((await h.graph.refresh()).edges.some(edge => edge.label === "./b"));
  h.vscode.workspace.textDocuments = [doc("import './c'")];
  const next = await h.graph.refresh();
  assert.ok(next.edges.some(edge => edge.label === "./c"));
  assert.ok(!next.edges.some(edge => edge.label === "./b"));
  h.graph.dispose();
});

test("newer refresh wins and disposal prevents late async publication", async () => {
  const h = harness({ open: ["a.ts"], files: { "/project/a.ts": "const a=1;", "/project/b.ts": "const b=2;" } });
  const stat = h.vscode.workspace.fs.stat;
  let unblock;
  h.vscode.workspace.fs.stat = async value => {
    if (value.path === "/project/a.ts") await new Promise(resolve => { unblock = resolve; });
    return stat(value);
  };
  const old = h.graph.refresh();
  h.vscode.window.tabGroups.all = [{ tabs: [{ input: { modified: uri("b.ts") } }] }];
  h.vscode.window.tabGroups.activeTabGroup.activeTab = { input: { modified: uri("b.ts") } };
  await h.graph.refresh();
  unblock();
  await old;
  assert.equal(h.messages.length, 1);
  assert.equal(h.graph.snapshot.nodes[0].label, "b.ts");
  h.graph.dispose();
  await h.graph.refresh();
  assert.equal(h.messages.length, 1);
  assert.equal(h.graph.resolve(h.graph.snapshot.activeId), undefined);
});
