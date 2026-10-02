import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { posix } from "../src/notes/uri-path.js";

// Compile the actual public entry with no module stubs or Node polyfills.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/extension.js", import.meta.url))],
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["vscode"],
  write: false,
  metafile: true,
  logLevel: "silent",
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const disposable = () => ({ dispose() {} });
const event = () => disposable();
const sealed = JSON.stringify({
  format: "aic-browser-vault",
  version: 1,
  cipher: { name: "AES-GCM", data: "AAAAAAAAAAAAAAAAAAAAAA==" },
});

async function harness({ writable = true } = {}) {
  function uri(path, scheme = "vscode-vfs", authority = "fixture") {
    return {
      scheme,
      authority,
      path: posix.normalize(path),
      query: "",
      fragment: "",
      get fsPath() {
        throw new Error("Virtual URI must never use fsPath");
      },
      toString() {
        return `${scheme}://${authority}${this.path}`;
      },
    };
  }
  const folder = { name: "workspace", uri: uri("/workspace") };
  const files = new Map([
    ["/workspace", { type: 2 }],
    ["/workspace/docs", { type: 2 }],
    ["/workspace/docs/readme.md", { type: 1, text: "# Browser note\n" }],
    ["/workspace/docs/source.ts", { type: 1, text: "const value = 1;\n" }],
    ["/workspace/docs.note.md", { type: 1, text: "# Shared\n" }],
    ["/workspace/workspace.note.md", { type: 1, text: "# Global\n" }],
    ["/workspace/notes.aicnotes", { type: 1, text: sealed }],
  ]);
  const providers = new Map(),
    commands = new Map(),
    documents = new Map(),
    errors = [];
  const changes = new Set(),
    saves = new Set();
  const executed = [];
  const getDocument = (target) => {
    if (documents.has(target.path)) return documents.get(target.path);
    let text = files.get(target.path)?.text;
    if (text === undefined) throw new Error("missing document");
    const document = {
      uri: target,
      languageId: "markdown",
      isClosed: false,
      isDirty: false,
      version: 1,
      getText: () => text,
      positionAt: (offset) => offset,
      replace(from, to, insert) {
        text = text.slice(0, from) + insert + text.slice(to);
        document.isDirty = true;
        document.version++;
        for (const listener of changes)
          listener({
            document,
            contentChanges: [
              { rangeOffset: from, rangeLength: to - from, text: insert },
            ],
          });
      },
      async save() {
        if (!writable) return false;
        files.get(target.path).text = text;
        document.isDirty = false;
        for (const listener of saves) listener(document);
        return true;
      },
    };
    documents.set(target.path, document);
    return document;
  };
  const api = {
    Uri: {
      joinPath: (base, ...parts) =>
        uri([base.path, ...parts].join("/"), base.scheme, base.authority),
    },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    Position: class {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    },
    Range: class {
      constructor(start, end) {
        this.start = start;
        this.end = end;
      }
    },
    WorkspaceEdit: class {
      constructor() {
        this.edits = [];
      }
      replace(target, range, text) {
        this.edits.push({ target, range, text });
      }
      createFile(target) {
        this.edits.push({ target, create: true });
      }
      insert(target, position, text) {
        this.edits.push({ target, range: { start: 0, end: 0 }, text });
      }
    },
    RelativePattern: class {
      constructor(base, pattern) {
        this.base = base;
        this.pattern = pattern;
      }
    },
    ConfigurationTarget: { Global: 1 },
    commands: {
      registerCommand: (name, handler) => {
        commands.set(name, handler);
        return disposable();
      },
      executeCommand: async (...args) => {
        executed.push(args);
      },
    },
    env: { clipboard: { writeText: async () => {}, readText: async () => "" } },
    languages: { registerCompletionItemProvider: event },
    window: {
      registerCustomEditorProvider: (name, provider) => {
        providers.set(name, provider);
        return disposable();
      },
      registerWebviewViewProvider: (name, provider) => {
        providers.set(name, provider);
        return disposable();
      },
      onDidChangeActiveTextEditor: event,
      tabGroups: {
        activeTabGroup: {},
        all: [],
        onDidChangeTabs: event,
        onDidChangeTabGroups: event,
      },
      showInformationMessage: async () => undefined,
      showErrorMessage: (message) => errors.push(message),
      showWarningMessage: (message) => {
        errors.push(message);
      },
      setStatusBarMessage() {},
    },
    workspace: {
      isTrusted: true,
      workspaceFolders: [folder],
      textDocuments: [],
      getWorkspaceFolder: (target) =>
        target.scheme === folder.uri.scheme &&
        target.authority === folder.uri.authority &&
        (target.path === folder.uri.path ||
          target.path.startsWith(`${folder.uri.path}/`))
          ? folder
          : undefined,
      asRelativePath: (target) => target.path.replace(/^\/workspace\/?/u, ""),
      getConfiguration: () => ({
        get: () => ({}),
        inspect: () => undefined,
        update: async () => {},
      }),
      createFileSystemWatcher: () => ({
        dispose() {},
        onDidCreate: event,
        onDidDelete: event,
      }),
      onDidChangeTextDocument: (listener) => {
        changes.add(listener);
        return { dispose: () => changes.delete(listener) };
      },
      onDidCloseTextDocument: event,
      onDidSaveTextDocument: (listener) => {
        saves.add(listener);
        return { dispose: () => saves.delete(listener) };
      },
      findFiles: async () =>
        [...files.keys()]
          .filter((path) => path.endsWith(".note.md"))
          .map((path) => uri(path)),
      openTextDocument: async (target) => getDocument(target),
      async applyEdit(edit) {
        if (!writable) return false;
        for (const item of edit.edits) {
          if (item.create) {
            if (files.has(item.target.path)) return false;
            files.set(item.target.path, { type: 1, text: "" });
          } else
            getDocument(item.target).replace(
              item.range.start,
              item.range.end,
              item.text,
            );
        }
        return true;
      },
      fs: {
        isWritableFileSystem: () => writable,
        stat: async (target) => {
          if (!files.has(target.path))
            throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          return { type: files.get(target.path).type };
        },
        readDirectory: async (target) =>
          [...files]
            .filter(([path]) => posix.dirname(path) === target.path)
            .map(([path, file]) => [posix.basename(path), file.type]),
        readFile: async (target) => {
          if (!files.has(target.path))
            throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          return encoder.encode(files.get(target.path).text);
        },
        createDirectory: async (target) => {
          assert.equal(writable, true);
          files.set(target.path, { type: 2 });
        },
        writeFile: async (target, bytes) => {
          assert.equal(writable, true);
          files.set(target.path, { type: 1, text: decoder.decode(bytes) });
        },
        rename: async (from, to, { overwrite }) => {
          assert.equal(writable, true);
          if (!overwrite && files.has(to.path)) throw new Error("exists");
          files.set(to.path, files.get(from.path));
          files.delete(from.path);
        },
        delete: async (target) => {
          assert.equal(writable, true);
          files.delete(target.path);
        },
      },
    },
  };
  const context = {
    extensionUri: uri("/extension", "https", "extension.test"),
    subscriptions: [],
    globalState: { get: () => true },
    workspaceState: { keys: () => [] },
  };
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    TextEncoder,
    TextDecoder,
    crypto,
    URL,
    console,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    require: (name) => {
      assert.equal(name, "vscode");
      return api;
    },
    fetch: () => assert.fail("Activation must not request a network service"),
  };
  assert.equal(sandbox.Buffer, undefined);
  assert.equal(sandbox.process, undefined);
  runInNewContext(bundle.outputFiles[0].text, sandbox);
  await module.exports.activate(context);
  await Promise.resolve();
  const panel = () => {
    let receive;
    let clientText = "";
    const messages = [];
    return {
      messages,
      active: true,
      onDidDispose: event,
      onDidChangeViewState: event,
      webview: {
        cspSource: "https://webview.test",
        asWebviewUri: (target) => target,
        postMessage: async (message) => {
          messages.push(message);
          if (message.type === "init") clientText = message.text;
          if (message.type === "editing.probe")
            queueMicrotask(() =>
              receive({
                type: "editing.snapshot",
                requestId: message.requestId,
                relativePath: message.relativePath,
                text: clientText,
                dirty: false,
              }),
            );
          return true;
        },
        onDidReceiveMessage: (listener) => {
          receive = listener;
          return disposable();
        },
      },
      receive: async (message) => receive(message),
    };
  };
  return {
    api,
    uri,
    files,
    providers,
    commands,
    executed,
    errors,
    getDocument,
    panel,
    dispose: () => context.subscriptions.forEach((item) => item.dispose?.()),
  };
}

test("browser entry activates real providers and saves a virtual Markdown TextDocument without Node globals", async () => {
  const h = await harness();
  try {
    assert.ok(h.providers.has("aicNotes.secondary"));
    assert.equal(h.providers.has("aicNotes.portable"), false);
    const document = h.getDocument(h.uri("/workspace/docs/readme.md"));
    const panel = h.panel();
    await h.providers
      .get("aicNotes.markdown")
      .resolveCustomTextEditor(document, panel);
    await panel.receive({ type: "ready" });
    const init = panel.messages.find((message) => message.type === "init");
    assert.equal(init.text, "# Browser note\n");
    assert.equal(init.readOnly, false);
    await panel.receive({
      type: "edit",
      generation: init.generation,
      changes: [{ from: 0, to: 0, insert: "Edited\n" }],
    });
    await panel.receive({
      type: "save",
      generation: init.generation,
      requestId: "save-1",
      relativePath: "docs/readme.md",
    });
    assert.equal(
      h.files.get("/workspace/docs/readme.md").text,
      "Edited\n# Browser note\n",
    );
    assert.equal(
      panel.messages.find((message) => message.type === "primary.saved").saved,
      true,
    );
    assert.deepEqual(h.errors, []);
  } finally {
    h.dispose();
  }
});

test("browser host opens linked virtual sources, creates a sidecar on explicit save and sets up agent instructions", async () => {
  const h = await harness();
  try {
    const pane = h.providers.get("aicNotes.secondary");
    const panel = h.panel();
    pane.resolveWebviewView(panel);
    await panel.receive({ type: "ready" });
    await pane.followSource(h.uri("/workspace/docs/source.ts"), {
      force: true,
    });
    assert.equal(
      pane.placeholderUri.toString(),
      "vscode-vfs://fixture/workspace/docs/source.note.md",
    );
    assert.equal(h.files.has("/workspace/docs/source.note.md"), false);
    const state = pane.ownership.state(pane.editSurface);
    await pane.commitDraft(
      "# Linked note\n",
      pane.generation,
      1,
      "docs/source.note.md",
      state.lease,
    );
    assert.equal(
      h.files.get("/workspace/docs/source.note.md").text,
      "# Linked note\n",
    );
    await h.commands.get("aicNotes.enableAgentWorkflow")();
    const marker = JSON.parse(
      h.files.get("/workspace/.vscode/aic-agent.json").text,
    );
    assert.match(marker.guideSha256, /^[a-f0-9]{64}$/u);
    assert.ok(h.files.has(`/workspace/${marker.guideFile}`));
    assert.equal(
      [...h.files.keys()].some((path) => path.endsWith(".tmp")),
      false,
    );
    assert.deepEqual(h.errors, []);
  } finally {
    h.dispose();
  }
});

test("read-only virtual providers render notes and reject edits or instruction writes", async () => {
  const h = await harness({ writable: false });
  try {
    const document = h.getDocument(h.uri("/workspace/docs/readme.md"));
    const panel = h.panel();
    await h.providers
      .get("aicNotes.markdown")
      .resolveCustomTextEditor(document, panel);
    await panel.receive({ type: "ready" });
    const init = panel.messages.find((message) => message.type === "init");
    assert.equal(init.readOnly, true);
    await panel.receive({
      type: "edit",
      generation: init.generation,
      changes: [{ from: 0, to: 0, insert: "changed" }],
    });
    assert.equal(document.getText(), "# Browser note\n");
    await h.commands.get("aicNotes.enableAgentWorkflow")();
    assert.ok(h.errors.some((message) => message.includes("read-only")));
    assert.equal(h.files.has("/workspace/.vscode/aic-agent.json"), false);
  } finally {
    h.dispose();
  }
});

test("activation leaves legacy encrypted files untouched and registers only Markdown editors", async () => {
  const h = await harness();
  try {
    assert.equal(h.providers.has("aicNotes.portable"), false);
    assert.ok(h.providers.has("aicNotes.markdown"));
    assert.equal(h.files.get("/workspace/notes.aicnotes").text, sealed);
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    assert.equal(
      manifest.contributes.customEditors.some((editor) =>
        editor.selector.some(
          (selector) => selector.filenamePattern === "*.aicnotes",
        ),
      ),
      false,
    );
  } finally {
    h.dispose();
  }
});

test("read-only virtual Markdown can navigate Shared and Global scope notes", async () => {
  const h = await harness({ writable: false });
  try {
    const document = h.getDocument(h.uri("/workspace/docs/readme.md"));
    const panel = h.panel();
    await h.providers
      .get("aicNotes.markdown")
      .resolveCustomTextEditor(document, panel);
    await panel.receive({ type: "ready" });
    const init = panel.messages.find((message) => message.type === "init");
    assert.equal(init.readOnly, true);
    for (const [id, path] of [
      ["shared", "docs.note.md"],
      ["global", "workspace.note.md"],
    ]) {
      await panel.receive({
        type: "scope.select",
        id,
        path,
        relativePath: "docs/readme.md",
        generation: init.generation,
      });
      const opened = h.executed.find(
        ([command, target]) =>
          command === "vscode.openWith" && target.path === `/workspace/${path}`,
      );
      assert.ok(opened, `Open ${id} while read-only`);
    }
    assert.equal(document.isDirty, false);
    assert.deepEqual(h.errors, []);
  } finally {
    h.dispose();
  }
});

test("manifest, builder and archive verifier require the browser host bundle", async () => {
  const read = (file) =>
    readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const manifest = JSON.parse(await read("package.json"));
  assert.equal(manifest.browser, "./dist/extension-browser.cjs");
  assert.match(await read("esbuild.mjs"), /jobs = \[host, browserHost\]/u);
  assert.match(
    await read("scripts/verify-release.mjs"),
    /extension\/dist\/extension-browser\.cjs/u,
  );
  assert.ok(
    Object.keys(bundle.metafile.inputs).includes("src/agents/bootstrap.js"),
  );
  assert.ok(
    Object.keys(bundle.metafile.inputs).every(
      (name) => !name.startsWith("node:"),
    ),
  );
});
