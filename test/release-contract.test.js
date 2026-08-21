import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("7.3.2 manifest separates Primary management from Secondary note content", () => {
  assert.equal(packageJson.version, "7.3.2");
  assert.equal(packageJson.engines.vscode, "^1.106.0");
  assert.equal(packageJson.scripts.publish, undefined);
  assert.ok(packageJson.scripts["release:gate"]);
  assert.ok(packageJson.contributes.views.aicNotes.some((view) => view.id === "aicNotes.tree"));
  assert.ok(
    packageJson.contributes.viewsContainers.secondarySidebar.some(
      (container) => container.id === "aicNotesSecondary",
    ),
  );
  assert.ok(
    packageJson.contributes.views.aicNotesSecondary.some(
      (view) => view.id === "aicNotes.secondary" && view.type === "webview",
    ),
  );
});

test("note association, global open hotkey, and footer surface are explicit", async () => {
  assert.equal(
    packageJson.contributes.configurationDefaults["workbench.editorAssociations"]["*.note.md"],
    "aicNotes.noteRedirect",
  );
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.deepEqual({ key: binding.key, mac: binding.mac }, { key: "ctrl+alt+n", mac: "cmd+alt+n" });
  assert.equal(binding.when, undefined);
  const titleItem = packageJson.contributes.menus["editor/title"].find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.match(titleItem.when, /not =~ \/\\\.note\\\.md\$\//u);
  const provider = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  const create = await readFile(new URL("../src/notes/create.js", import.meta.url), "utf8");
  const extension = await readFile(new URL("../src/extension.js", import.meta.url), "utf8");
  assert.match(provider, /id="secondary-footer"/u);
  assert.match(provider, /id="pane-pin"/u);
  assert.doesNotMatch(provider, /id="pane-(?:auto|sync|create|note-actions)"/u);
  assert.match(provider, /tabGroups\.close/u);
  assert.match(create, /secondary\.followSource\(uri, \{ force: true, preserveFocus: false \}\)/u);
  assert.doesNotMatch(create, /ensureFileNoteForUri/u);
  assert.match(extension, /noteForCurrentFile\(secondary\)/u);
});

test("source selections expose the AIC linked-comment action without targeting note files", async () => {
  const binding = packageJson.contributes.keybindings.find(
    ({ command, key }) => command === "aicNotes.linkSelectionToNote" && key === "ctrl+alt+l",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac },
    { key: "ctrl+alt+l", mac: "cmd+alt+l" },
  );
  assert.ok(packageJson.contributes.keybindings.some(
    ({ command, key, mac }) => command === "aicNotes.linkSelectionToNote" &&
      key === "ctrl+shift+/" && mac === "cmd+shift+/",
  ));
  assert.match(binding.when, /editorHasSelection/u);
  assert.match(binding.when, /not =~ \/\\\.note\\\.md\$\//u);
  const menu = packageJson.contributes.menus["editor/context"].find(
    ({ command }) => command === "aicNotes.linkSelectionToNote",
  );
  assert.match(menu.when, /editorHasSelection/u);
  const selection = await readFile(new URL("../src/notes/selection.js", import.meta.url), "utf8");
  assert.match(selection, /document\.isDirty/u);
  assert.match(selection, /await document\.save\(\)/u);
  assert.match(selection, /document\.getText\(editor\.selection\)/u);
  assert.match(selection, /secondary\.open[\s\S]*selection:/u);
  assert.doesNotMatch(selection, /mode: "(?:edit|preview)"/u);
  assert.doesNotMatch(selection, /edit\.replace\(document\.uri/u);
});

test("Secondary editable placeholder, pinned footer, blur save, and theme-safe controls are scoped", async () => {
  const provider = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  const webview = await readFile(new URL("../src/webview/main.js", import.meta.url), "utf8");
  const details = await readFile(new URL("../src/webview/details.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/webview/theme.css", import.meta.url), "utf8");
  assert.match(provider, /fileNotePlaceholderForUri/u);
  assert.match(provider, /createFromPlaceholder/u);
  assert.match(provider, /workspace\.fs\.writeFile/u);
  assert.match(provider, /id="pane-breadcrumb"/u);
  assert.match(provider, /id="pane-filename"/u);
  assert.match(provider, /id="pane-auth"/u);
  assert.match(provider, /showPinnedActions/u);
  assert.match(provider, /onDidSaveTextDocument/u);
  assert.match(provider, /CoalescingQueue/u);
  assert.match(provider, /case "ready":[\s\S]*else await this\.followActive\(\)/u);
  assert.match(webview, /reason: "blur"/u);
  assert.match(webview, /EditorState\.readOnly\.of\(docState\.readOnly\)/u);
  assert.match(webview, /if \(!docState\.readOnly\) requestAnimationFrame\(\(\) => view\?\.focus\(\)\)/u);
  assert.doesNotMatch(webview, /pane\.(?:create|sync|autoOpen|reveal)/u);
  assert.doesNotMatch(provider, /case "pane\.sync"/u);
  assert.doesNotMatch(provider, /pane-mode/u);
  assert.doesNotMatch(webview, /paneMode|setPaneMode/u);
  assert.match(details, /EditorView\.decorations\.from\(field\)/u);
  assert.doesNotMatch(details, /ViewPlugin/u);
  assert.match(css, /--aic-contrast-fg:[^;]*--vscode-foreground/u);
  assert.match(css, /\.aic-secondary-surface \.cm-editor \{ font-size: 0\.875rem; \}/u);
  assert.match(css, /\.aic-secondary-surface \.cm-scroller \{ line-height: 1\.42; \}/u);
  assert.match(css, /#secondary-footer/u);
  assert.match(css, /\.cm-aic-details-summary/u);
  assert.match(css, /--aic-details-surface:/u);
  assert.match(details, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(details, /textContent = "Edit source"/u);
  assert.doesNotMatch(details, /[▸▾]/u);
});

test("headless authorization uses SecretStorage plus the encrypted bridge vault", async () => {
  const client = await readFile(new URL("../src/sync/client.js", import.meta.url), "utf8");
  const vault = await readFile(new URL("../src/sync/vault.js", import.meta.url), "utf8");
  const bridge = await readFile(new URL("../bridge/main.go", import.meta.url), "utf8");
  assert.match(client, /sessionVaultConfig/u);
  assert.match(vault, /context\.secrets\.store/u);
  assert.match(vault, /standard-notes-session\.v1\.json/u);
  assert.doesNotMatch(bridge, /session\.UpdateSession/u);
  assert.doesNotMatch(bridge, /session\.GetSessionFromKeyring/u);
  assert.match(bridge, /ReadOnly/u);
  assert.match(bridge, /case "disconnect"/u);
  assert.match(client, /async logout\(\)/u);
});

test("Secondary recovers closed documents and exposes local-only note actions", async () => {
  const provider = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  const actions = await readFile(new URL("../src/secondary/note-actions.js", import.meta.url), "utf8");
  const deletion = await readFile(new URL("../src/notes/delete.js", import.meta.url), "utf8");
  assert.match(provider, /this\.documentUri/u);
  assert.match(provider, /this\.document\.isClosed/u);
  assert.match(provider, /workspace\.openTextDocument\(uri\)/u);
  assert.match(provider, /clearNoteContent/u);
  assert.match(provider, /deleteCurrentNote/u);
  assert.match(actions, /CHECKLIST_BODY = "- \[ \]\\n"/u);
  assert.match(deletion, /useTrash: true/u);
  assert.match(deletion, /"Delete Permanently"/u);
});

test("portable agent workflow uses only a thin .vscode marker and typed AIC commands", async () => {
  const contract = await readFile(new URL("../src/agents/contract.js", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../src/agents/bootstrap.js", import.meta.url), "utf8");
  assert.match(contract, /\["\.vscode", "aic-agent\.json"\]/u);
  assert.match(contract, /guideCommand: "aic guide --json"/u);
  assert.match(contract, /ownerNotes: "\*\.note\.md"/u);
  assert.match(contract, /taskArtifacts: "\*\.ai\.md"/u);
  assert.doesNotMatch(contract, /instructionPack|English practice/u);
  assert.match(bootstrap, /\["rules", "status", "--json"\]/u);
  assert.match(bootstrap, /\["rules", "sync", "--json"\]/u);
  assert.match(bootstrap, /workspace\.isTrusted/u);
  assert.doesNotMatch(bootstrap, /AGENTS\.md.*writeFile|\.aic\//u);
});

test("release packaging includes the helper but excludes helper source", async () => {
  const ignore = await readFile(new URL("../.vscodeignore", import.meta.url), "utf8");
  assert.match(ignore, /^bridge\/\*\*$/mu);
  assert.doesNotMatch(ignore, /^bin\//mu);
  const goMod = await readFile(new URL("../bridge/go.mod", import.meta.url), "utf8");
  assert.match(goMod, /28e3820a341f/u);
  const provenance = await readFile(new URL("../PROVENANCE.md", import.meta.url), "utf8");
  assert.match(provenance, /5e8f000ca1dff2880ed1da5042a47bc511202ff7/u);
  assert.match(provenance, /7716a0d940a0f6ae8e1f3b3f4f36299dc53e31b16840dbd171254312c41ca12e/u);
});
