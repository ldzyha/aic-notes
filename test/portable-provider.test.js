import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/portable/provider.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});
const sealed = (data = "AAAAAAAAAAAAAAAAAAAAAA==") =>
  JSON.stringify({
    format: "aic-browser-vault",
    version: 1,
    cipher: { name: "AES-GCM", data },
  });
const html =
  '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src self"><link rel="manifest" href="./manifest.webmanifest"><link rel="stylesheet" href="./assets/main.css"></head><body><div id="app"></div><script type="module" src="./assets/main.js"></script></body></html>';

function harness({
  text = sealed(),
  save = true,
  apply = true,
  deleted = false,
  deleteDuringApply = false,
} = {}) {
  const messages = [];
  const changes = new Set();
  let receiver;
  let disposePanel;
  let editCount = 0;
  let saveCount = 0;
  const uri = (path) => ({ toString: () => path });
  const document = {
    uri: uri("file:///workspace/notes.aicnotes"),
    isClosed: false,
    getText: () => text,
    positionAt: (offset) => offset,
    save: async () => {
      saveCount++;
      return save;
    },
  };
  const api = {
    Uri: {
      joinPath: (parent, ...parts) =>
        uri(`${parent.toString()}/${parts.join("/")}`),
    },
    WorkspaceEdit: class {
      replace(_uri, _range, value) {
        this.text = value;
      }
    },
    Range: class {},
    workspace: {
      fs: {
        readFile: async () => Buffer.from(html),
        stat: async () => {
          if (deleted) throw new Error("missing");
          return {};
        },
      },
      applyEdit: async (edit) => {
        editCount += 1;
        if (!apply) return false;
        text = edit.text;
        if (deleteDuringApply) deleted = true;
        for (const listener of changes) listener({ document });
        return true;
      },
      onDidChangeTextDocument: (listener) => {
        changes.add(listener);
        return { dispose: () => changes.delete(listener) };
      },
    },
  };
  const panel = {
    webview: {
      cspSource: "vscode-webview://local",
      asWebviewUri: (value) => `vscode-webview://resources/${value.toString()}`,
      onDidReceiveMessage: (listener) => {
        receiver = listener;
        return {
          dispose: () => {
            receiver = undefined;
          },
        };
      },
      postMessage: async (message) => {
        messages.push(message);
        return true;
      },
    },
    onDidDispose: (listener) => {
      disposePanel = listener;
      return { dispose() {} };
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => (name === "vscode" ? api : require(name)),
    Buffer,
    Error,
    console,
  });
  const provider = new module.exports.PortableEditorProvider(
    { extensionUri: uri("extension://aic") },
    api,
  );
  return {
    provider,
    document,
    panel,
    messages,
    changes,
    api,
    ready: () => provider.resolveCustomTextEditor(document, panel),
    request: (message) => receiver(message),
    current: () => text,
    saves: () => saveCount,
    edits: () => editCount,
    external: (value) => {
      text = value;
      for (const listener of changes) listener({ document });
    },
    close: () => disposePanel(),
    portableHtml: module.exports.portableHtml,
  };
}

test("portable editor reads correlated ciphertext and saves through its TextDocument owner", async () => {
  const initial = sealed();
  const next = sealed("BBBBBBBBBBBBBBBBBBBBBB==");
  const fixture = harness({ text: initial });
  await fixture.ready();
  await fixture.request({ type: "portable.read", requestId: "read-1" });
  assert.equal(fixture.messages[0].text, initial);
  assert.equal(fixture.messages[0].requestId, "read-1");
  await fixture.request({
    type: "portable.write",
    requestId: "write-1",
    text: next,
    expected: initial,
  });
  assert.equal(fixture.current(), next);
  assert.equal(fixture.edits(), 1);
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.messages[1])), {
    requestId: "write-1",
    ok: true,
    text: next,
  });
  assert.equal(
    fixture.messages.some((message) => message.type === "portable.changed"),
    false,
  );
  fixture.provider.dispose();
});

test("stale writes, plaintext and missing expected ciphertext cannot mutate the document", async () => {
  const fixture = harness();
  await fixture.ready();
  for (const [requestId, text, expected] of [
    ["stale", sealed("CCCCCCCCCCCCCCCCCCCCCC=="), "older"],
    ["plain", "secret plaintext", fixture.current()],
    ["missing", sealed("CCCCCCCCCCCCCCCCCCCCCC=="), undefined],
  ]) {
    await fixture.request({
      type: "portable.write",
      requestId,
      text,
      expected,
    });
    assert.equal(fixture.messages.at(-1).ok, false);
    assert.equal(fixture.messages.at(-1).requestId, requestId);
  }
  assert.equal(fixture.edits(), 0);
  fixture.provider.dispose();
});

test("null expected ciphertext creates only an empty document", async () => {
  const empty = harness({ text: "" });
  await empty.ready();
  await empty.request({
    type: "portable.write",
    requestId: "create",
    text: sealed(),
    expected: null,
  });
  assert.equal(empty.messages.at(-1).ok, true);
  empty.provider.dispose();
  const existing = harness();
  await existing.ready();
  await existing.request({
    type: "portable.write",
    requestId: "replace",
    text: sealed(),
    expected: null,
  });
  assert.equal(existing.messages.at(-1).ok, false);
  assert.equal(existing.edits(), 0);
  existing.provider.dispose();
});

test("failed apply and failed save send one terminal acknowledgment and preserve encrypted state", async () => {
  for (const failure of ["apply", "save"]) {
    const fixture = harness({ [failure]: false });
    await fixture.ready();
    const next = sealed("CCCCCCCCCCCCCCCCCCCCCC==");
    await fixture.request({
      type: "portable.write",
      requestId: failure,
      text: next,
      expected: fixture.current(),
    });
    assert.equal(fixture.messages.length, 1);
    assert.equal(fixture.messages[0].ok, false);
    assert.equal(fixture.current(), failure === "save" ? next : sealed());
    await fixture.request({
      type: "portable.read",
      requestId: "after-failure",
    });
    assert.equal(fixture.messages.at(-1).ok, true);
    fixture.provider.dispose();
  }
});

test("external changes notify without silently replacing webview content and disposal removes listeners", async () => {
  const fixture = harness();
  await fixture.ready();
  fixture.external(sealed("DDDDDDDDDDDDDDDDDDDDDD=="));
  assert.equal(fixture.messages[0].type, "portable.changed");
  assert.deepEqual(Object.keys(fixture.messages[0]), ["type"]);
  fixture.close();
  assert.equal(fixture.changes.size, 0);
  fixture.external(sealed());
  assert.equal(fixture.messages.length, 1);
});

test("portable webview allows only generated resources and denies network connections", async () => {
  const fixture = harness();
  await fixture.ready();
  const result = fixture.panel.webview.html;
  assert.match(result, /connect-src 'none'/u);
  assert.match(result, /worker-src 'none'/u);
  assert.match(result, /script nonce="[A-Za-z0-9+/=]+"/u);
  assert.match(
    result,
    /src="vscode-webview:\/\/resources\/extension:\/\/aic\/dist\/portable\/assets\/main\.js"/u,
  );
  assert.doesNotMatch(result, /rel="manifest"/u);
  assert.deepEqual(
    Array.from(fixture.panel.webview.options.localResourceRoots, (item) =>
      item.toString(),
    ),
    ["extension://aic/dist/portable"],
  );
  for (const resource of [
    "https://evil.test/run.js",
    "../escape.js",
    "/root.js",
  ]) {
    assert.throws(
      () =>
        fixture.portableHtml(
          fixture.panel.webview,
          fixture.api.Uri.joinPath(
            { toString: () => "extension://aic" },
            "dist",
            "portable",
          ),
          `<html><head></head><script src="${resource}"></script></html>`,
          fixture.api,
        ),
      /unsafe resource path/u,
    );
  }
  fixture.provider.dispose();
});

test("oversize transport messages are rejected without filesystem mutation", async () => {
  const fixture = harness();
  await fixture.ready();
  await fixture.request({
    type: "portable.write",
    requestId: "oversize",
    text: "a".repeat(9 * 1024 * 1024 + 1),
    expected: fixture.current(),
  });
  assert.equal(fixture.messages.at(-1).ok, false);
  assert.equal(fixture.edits(), 0);
  fixture.provider.dispose();
});

test("deleted encrypted files are never saved or recreated and changes remain recoverable", async () => {
  for (const options of [{ deleted: true }, { deleteDuringApply: true }]) {
    const fixture = harness(options);
    await fixture.ready();
    const initial = fixture.current();
    const next = sealed("CCCCCCCCCCCCCCCCCCCCCC==");
    await fixture.request({
      type: "portable.write",
      requestId: "deleted",
      expected: initial,
      text: next,
    });
    const reply = fixture.messages.find(
      (message) => message.requestId === "deleted",
    );
    assert.equal(reply.ok, false);
    assert.match(reply.error, /deleted.*changes remain/u);
    assert.equal(fixture.saves(), 0);
    assert.equal(fixture.current(), options.deleted ? initial : next);
  }
});
