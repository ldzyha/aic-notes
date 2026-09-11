import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const bundled = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/secondary/provider.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

function harness(failure) {
  const uri = {
    fsPath: failure === "stamp" ? null : "D:/workspace/project.note.md",
    toString: () => "file:///D:/workspace/project.note.md",
  };
  const messages = [];
  const errors = [];
  let text = "base";
  const document = {
    uri,
    getText: () => text,
    positionAt: (offset) => offset,
    save: async () => {
      if (failure === "save-throw") throw new Error("save failed");
      return failure !== "save-false";
    },
  };
  const vscode = {
    WorkspaceEdit: class {
      replace(_uri, _range, next) {
        this.text = next;
      }
    },
    Range: class {},
    workspace: {
      asRelativePath: () => {
        if (failure === "path") throw new Error("path failed");
        return "project.note.md";
      },
      fs: {
        stat: async () => {
          if (failure === "open" || failure === "refresh")
            throw new Error("missing");
          return { ctime: 1 };
        },
        writeFile: async () => {},
      },
      openTextDocument: async () => {
        if (failure === "open") throw new Error("open failed");
        return document;
      },
      applyEdit: async (edit) => {
        if (failure === "apply") throw new Error("apply failed");
        text = edit.text;
        return true;
      },
    },
    commands: {
      executeCommand: async () => {
        if (failure === "refresh") throw new Error("refresh failed");
      },
    },
    window: { showErrorMessage: (message) => errors.push(message) },
  };
  const module = { exports: {} };
  runInNewContext(bundled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => (name === "vscode" ? vscode : require(name)),
    TextEncoder,
    TextDecoder,
    URL,
    Buffer,
    console,
  });
  const pane = new module.exports.SecondaryNotePane({});
  pane.view = {
    webview: {
      postMessage: async (message) => {
        messages.push(message);
        return true;
      },
    },
  };
  pane.generation = 3;
  pane.draftDirty = true;
  if (failure === "open" || failure === "refresh") {
    pane.placeholderUri = uri;
    pane.placeholderText = "placeholder";
  } else pane.documentUri = uri;
  pane.currentDocument = async () => {
    if (failure === "current") throw new Error("current document failed");
    return document;
  };
  pane.sendPaneState = async () => {
    if (failure === "status") throw new Error("status failed");
  };
  return { pane, messages, errors };
}

for (const failure of [
  "path",
  "stamp",
  "open",
  "refresh",
  "current",
  "apply",
  "save-false",
  "save-throw",
]) {
  test(`commit ${failure} failure sends one correlated terminal result and permits retry`, async () => {
    const { pane, messages } = harness(failure);
    await pane.onMessage({
      type: "commit",
      text: "local edit",
      generation: 3,
      requestId: 9,
      relativePath: "project.note.md",
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "committed");
    assert.equal(messages[0].saved, false);
    assert.equal(messages[0].requestId, 9);
    assert.equal(messages[0].relativePath, "project.note.md");
    await pane.onMessage({
      type: "commit",
      text: "retry",
      generation: 3,
      requestId: 10,
      relativePath: "project.note.md",
    });
    assert.equal(
      messages.length,
      2,
      "rejected queue must process the next explicit request",
    );
    assert.equal(messages[1].requestId, 10);
  });
}

test("a status failure after saving cannot send a contradictory failure acknowledgment", async () => {
  const { pane, messages } = harness("status");
  await assert.rejects(
    pane.onMessage({
      type: "commit",
      text: "local edit",
      generation: 3,
      requestId: 9,
      relativePath: "project.note.md",
    }),
    /status failed/u,
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].saved, true);
  assert.equal(messages[0].requestId, 9);
});

test("queued draft-state messages for an old note cannot clear current dirty state", async () => {
  const { pane } = harness();
  pane.draftDirty = true;
  await pane.onMessage({
    type: "draft.state",
    relativePath: "old.note.md",
    dirty: false,
    pending: false,
  });
  assert.equal(pane.draftDirty, true);
  assert.equal(pane.draftRevision, 0);
  await pane.onMessage({
    type: "draft.state",
    relativePath: "project.note.md",
    dirty: false,
    pending: true,
  });
  assert.equal(pane.draftDirty, true);
  assert.equal(pane.draftRevision, 1);
});
