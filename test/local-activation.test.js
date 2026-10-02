import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const stubs = {
  "./notes/create.js": `
    export const noteForCurrentFile = () => {};
    export const noteForExplorerItem = () => {};
    export const openProjectNote = () => {};
    export const commandHandler = (handler) => handler;`,
  "./notes/nesting.js": `
    export const enableExplorerNesting = () => {};
    export const hintIfShadowed = () => {};`,
  "./editor/provider.js":
    "export const MarkdownEditorProvider = { register: () => ({}) };",
  "./editor/slash-provider.js":
    "export const registerMarkdownSlashCompletionProvider = () => ({});",
  "./secondary/provider.js":
    "export const SecondaryNotePane = { register: () => ({ open() {} }) };",
  "./secondary/model.js": "export const activeResource = () => undefined;",
  "./notes/edit-ownership.js": "export class NoteEditOwnership {}",
  "./notes/selection.js": "export const linkSelectionToNote = () => {};",
  "./agents/bootstrap.js":
    "export const AgentWorkflowBootstrap = { register: () => {} };",
};

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/extension.js", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  logLevel: "silent",
  plugins: [
    {
      name: "local-provider-stubs",
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\// }, (args) =>
          Object.hasOwn(stubs, args.path)
            ? { path: args.path, namespace: "local-stub" }
            : undefined,
        );
        plugin.onLoad({ filter: /.*/, namespace: "local-stub" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});

test("local extension activates without account commands or network access", async () => {
  const commands = [];
  const deleted = [];
  const marks = [];
  let treeProviders = 0;
  const vscode = {
    window: {
      registerTreeDataProvider: () => {
        treeProviders += 1;
        return { dispose() {} };
      },
      tabGroups: { activeTabGroup: { activeTab: undefined } },
      activeTextEditor: undefined,
      showInformationMessage: async () => undefined,
    },
    commands: {
      registerCommand: (name) => {
        commands.push(name);
        return { dispose() {} };
      },
    },
    workspace: {
      getConfiguration: () => ({ get: () => ({}), update: async () => {} }),
    },
    ConfigurationTarget: { Global: 1 },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: (name) => {
      assert.equal(name, "vscode");
      return vscode;
    },
    fetch: () => assert.fail("activation must not connect to an account"),
  });
  const context = {
    subscriptions: [],
    globalState: {
      get: (key) => key === "aicNotes.migrations.standardNotesRemoved.v22",
      update: async (key, value) => marks.push([key, value]),
    },
    secrets: { delete: async (key) => deleted.push(key) },
  };
  await module.exports.activate(context);
  assert.ok(commands.includes("aicNotes.noteForCurrentFile"));
  assert.ok(commands.includes("aicNotes.linkSelectionToNote"));
  assert.ok(commands.includes("aicNotes.openInSecondary"));
  assert.equal(treeProviders, 0);
  for (const retired of [
    "aicNotes.refreshTree",
    "aicNotes.openTarget",
    "aicNotes.copyWikiLink",
    "aicNotes.openNote",
    "aicNotes.deleteNote",
    "aicNotes.deleteFolderNotes",
  ])
    assert.ok(!commands.includes(retired));
  assert.ok(
    commands.every(
      (name) => !/standardNotes|Account|signIn|signOut/iu.test(name),
    ),
  );
  assert.deepEqual(deleted, ["aicNotes.snAuth.session.v1"]);
  assert.deepEqual(marks, [
    ["aicNotes.migrations.standardNotesAuthRemoved.v1", true],
  ]);
});
