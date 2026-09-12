import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { encodeAgentMarker, MIN_AIC_RULES_VERSION } from "../src/agents/contract.js";

const require = createRequire(import.meta.url);
const bundle = await build({
  stdin: {
    contents: 'export { AgentWorkflowBootstrap } from "./src/agents/bootstrap.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});

function harness({ trusted, marker }) {
  const calls = [];
  let trustListener;
  const uri = (value) => ({ scheme: "file", path: value, fsPath: value, toString: () => `file://${value}` });
  const folder = { name: "workspace", uri: uri("/workspace") };
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri([base.path, ...parts].join("/")) },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      isTrusted: trusted,
      workspaceFolders: [folder],
      fs: {
        stat: async () => {
          if (!marker) throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          return { type: 1 };
        },
        readFile: async () => new TextEncoder().encode(encodeAgentMarker()),
      },
      getConfiguration: () => ({ get: () => "aic" }),
      onDidGrantWorkspaceTrust: (listener) => {
        trustListener = listener;
        return { dispose() {} };
      },
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: () => undefined,
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => name === "vscode" ? vscode : name === "node:child_process" ? {
      execFile: (_executable, args, _options, callback) => {
        calls.push([...args]);
        callback(null, JSON.stringify({ schemaVersion: 1, rulesVersion: MIN_AIC_RULES_VERSION, state: "current", targets: [] }), "");
      },
    } : require(name),
    TextDecoder,
    TextEncoder,
    Buffer,
    console,
    queueMicrotask() {},
  });
  const context = {
    extension: { packageJSON: { version: "99.0.0" } },
    workspaceState: { get: () => "99.0.0", update: async () => undefined },
    subscriptions: [],
  };
  return { bootstrap: new module.exports.AgentWorkflowBootstrap(context), calls, vscode,
    register: () => module.exports.AgentWorkflowBootstrap.register(context),
    grantTrust: () => trustListener?.() };
}

test("untrusted workspace never starts the agent executable, even with an existing marker", async () => {
  const h = harness({ trusted: false, marker: true });
  await h.bootstrap.activate();
  assert.deepEqual(h.calls, []);
  await assert.rejects(h.bootstrap.sync(), /agent_workspace_untrusted/u);
  assert.deepEqual(h.calls, []);
});

test("extension upgrade without an opt-in marker does not run or sync AIC rules", async () => {
  const h = harness({ trusted: true, marker: false });
  await h.bootstrap.activate();
  assert.deepEqual(h.calls, []);
});

test("a trusted workspace with a valid marker verifies the AIC rule contract", async () => {
  const h = harness({ trusted: true, marker: true });
  await h.bootstrap.activate();
  assert.deepEqual(h.calls, [["rules", "status", "--json"]]);
});

test("granting trust activates an existing opt-in marker", async () => {
  const h = harness({ trusted: false, marker: true });
  h.register();
  assert.deepEqual(h.calls, []);
  h.vscode.workspace.isTrusted = true;
  await h.grantTrust();
  assert.deepEqual(h.calls, [["rules", "status", "--json"]]);
});
