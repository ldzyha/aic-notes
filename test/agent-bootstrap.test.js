import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { AGENT_GUIDE } from "../vendor/aic-editor-core/agent-guide.js";
import {
  agentGuideIdentity,
  encodeAgentMarker,
} from "../src/agents/contract.js";
const require = createRequire(import.meta.url);
const AGENT_GUIDE_PATH = (await agentGuideIdentity()).path;
const markerText = await encodeAgentMarker();
const bundle = await build({
  stdin: {
    contents:
      'export { AgentWorkflowBootstrap } from "./src/agents/bootstrap.js";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
});
function harness({
  trusted = true,
  marker,
  guide,
  directoryType = 2,
  failGuide = false,
} = {}) {
  const files = new Map(),
    writes = [],
    commands = new Map(),
    copied = [];
  const uri = (path) => ({ path, fsPath: path, scheme: "file" });
  const guidePath = `/workspace/${AGENT_GUIDE_PATH.join("/")}`;
  if (marker !== undefined)
    files.set("/workspace/.vscode/aic-agent.json", marker);
  if (guide !== undefined) files.set(guidePath, guide);
  files.set("/workspace/AGENTS.md", "Owner instructions");
  const folder = { name: "workspace", uri: uri("/workspace") };
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri([base.path, ...parts].join("/")) },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      isTrusted: trusted,
      workspaceFolders: [folder],
      getWorkspaceFolder: () => folder,
      fs: {
        stat: async (target) => {
          if (target.path === "/workspace/.vscode")
            return { type: directoryType };
          if (!files.has(target.path))
            throw Object.assign(new Error("missing"), { code: "FileNotFound" });
          return { type: 1 };
        },
        readFile: async (target) =>
          new TextEncoder().encode(files.get(target.path)),
        createDirectory: async () => {},
        writeFile: async (target, value) => {
          writes.push(target.path);
          files.set(target.path, new TextDecoder().decode(value));
        },
        rename: async (from, to, options) => {
          if (failGuide && to.path === guidePath) throw new Error("disk full");
          if (!options.overwrite && files.has(to.path))
            throw new Error("exists");
          files.set(to.path, files.get(from.path));
          files.delete(from.path);
        },
        delete: async (target) => {
          files.delete(target.path);
        },
      },
    },
    commands: {
      registerCommand: (name, callback) => {
        commands.set(name, callback);
        return { dispose() {} };
      },
    },
    env: {
      clipboard: {
        writeText: async (text) => {
          copied.push(text);
        },
      },
    },
    window: {
      showInformationMessage: async () => undefined,
      showWarningMessage: () => undefined,
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => {
      if (name === "vscode") return vscode;
      if (name.includes("child_process"))
        throw new Error("No subprocesses permitted");
      return require(name);
    },
    TextDecoder,
    TextEncoder,
    crypto,
    console,
  });
  const bootstrap = module.exports.AgentWorkflowBootstrap.register({
    subscriptions: [],
  });
  return { bootstrap, files, writes, commands, copied, guidePath };
}
test("registration does not run a CLI or change files", () => {
  for (const marker of [undefined, markerText])
    assert.deepEqual(harness({ marker }).writes, []);
});
test("fresh setup works without AIC or its config and is idempotent", async () => {
  const h = harness();
  await h.bootstrap.enable();
  assert.equal(h.files.get(h.guidePath), AGENT_GUIDE);
  assert.equal(h.files.get("/workspace/.vscode/aic-agent.json"), markerText);
  assert.equal(h.files.get("/workspace/AGENTS.md"), "Owner instructions");
  const count = h.writes.length;
  await h.bootstrap.enable();
  assert.equal(h.writes.length, count);
});
test("refresh exports sidecar discovery without rewriting owner context or the previous guide", async () => {
  const previousGuide = "Previous bundled instructions";
  const previousHash = createHash("sha256").update(previousGuide).digest("hex");
  const previousPath = `.vscode/aic-agent-${previousHash.slice(0, 16)}.md`;
  const h = harness({
    marker: JSON.stringify({
      schemaVersion: 2,
      enabled: true,
      managedBy: "aic-notes",
      guideVersion: 2,
      guideFile: previousPath,
      guideSha256: previousHash,
    }),
  });
  const protectedFiles = new Map([
    [`/workspace/${previousPath}`, previousGuide],
    ["/workspace/src/parser.note.md", "Owner decisions and ready answers"],
    ["/workspace/.ai/session.json", "Runtime-owned session state"],
  ]);
  for (const [path, text] of protectedFiles) h.files.set(path, text);
  await h.bootstrap.enable();
  assert.equal(h.files.get(h.guidePath), AGENT_GUIDE);
  assert.match(h.files.get(h.guidePath), /Include \*\*\/\*\.note\.md/u);
  assert.match(h.files.get(h.guidePath), /not higher-priority instructions/u);
  assert.equal(h.files.get("/workspace/.vscode/aic-agent.json"), markerText);
  for (const [path, text] of protectedFiles)
    assert.equal(h.files.get(path), text);
  assert.equal(h.files.get("/workspace/AGENTS.md"), "Owner instructions");
  assert.ok(
    h.writes.every((path) => path.startsWith("/workspace/.vscode/.aic-agent-")),
  );
});
test("untrusted workspaces can copy instructions but cannot write them", async () => {
  const h = harness({ trusted: false });
  await assert.rejects(h.bootstrap.enable(), /agent_workspace_untrusted/u);
  assert.deepEqual(h.writes, []);
  await h.commands.get("aicNotes.copyAgentInstructions")();
  assert.deepEqual(h.copied, [AGENT_GUIDE]);
});
test("legacy setup migrates only on explicit command", async () => {
  const legacy = JSON.stringify({
    schemaVersion: 1,
    enabled: true,
    managedBy: "aic-notes",
    minimumRulesVersion: 8,
    guideCommand: "aic guide --json",
  });
  const h = harness({ marker: legacy });
  assert.equal(h.files.get("/workspace/.vscode/aic-agent.json"), legacy);
  await h.bootstrap.enable();
  assert.equal(h.files.get("/workspace/.vscode/aic-agent.json"), markerText);
});
test("edited instructions, foreign markers and symlink directories stay untouched", async () => {
  for (const options of [
    { guide: "Owner edits" },
    { marker: "Owner marker" },
    { directoryType: 66 },
  ]) {
    const h = harness(options);
    await assert.rejects(h.bootstrap.enable());
    assert.deepEqual(h.writes, []);
  }
});
test("failed guide writes leave no enabled marker or temporary file", async () => {
  const h = harness({ failGuide: true });
  await assert.rejects(h.bootstrap.enable(), /disk full/u);
  assert.equal(h.files.has("/workspace/.vscode/aic-agent.json"), false);
  assert.equal(
    [...h.files.keys()].some((path) => path.endsWith(".tmp")),
    false,
  );
});
