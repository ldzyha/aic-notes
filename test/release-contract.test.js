import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("4.3.3 manifest separates Primary management from Secondary note content", () => {
  assert.equal(packageJson.version, "4.3.3");
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

test("note association, hotkey, checkbox surface, and ordinary-file icon are explicit", async () => {
  assert.equal(
    packageJson.contributes.configurationDefaults["workbench.editorAssociations"]["*.note.md"],
    "aicNotes.noteRedirect",
  );
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.deepEqual({ key: binding.key, mac: binding.mac }, { key: "ctrl+alt+n", mac: "cmd+alt+n" });
  const titleItem = packageJson.contributes.menus["editor/title"].find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.match(titleItem.when, /not =~ \/\\\.note\\\.md\$\//u);
  const provider = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  assert.match(provider, /id="pane-auto"/u);
  assert.match(provider, /workspaceState\.get\(AUTO_OPEN_KEY, true\)/u);
  assert.match(provider, /tabGroups\.close/u);
});

test("source selections expose the AIC linked-comment action without targeting note files", async () => {
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.linkSelectionToNote",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac },
    { key: "ctrl+shift+/", mac: "cmd+shift+/" },
  );
  assert.match(binding.when, /editorHasSelection/u);
  assert.match(binding.when, /not =~ \/\\\.note\\\.md\$\//u);
  const menu = packageJson.contributes.menus["editor/context"].find(
    ({ command }) => command === "aicNotes.linkSelectionToNote",
  );
  assert.match(menu.when, /editorHasSelection/u);
  const selection = await readFile(new URL("../src/notes/selection.js", import.meta.url), "utf8");
  assert.match(selection, /document\.isDirty/u);
  assert.match(selection, /secondary\.open[\s\S]*mode: "edit"[\s\S]*selection:/u);
  assert.doesNotMatch(selection, /edit\.replace\(document\.uri/u);
});

test("Secondary placeholder, compact density, edit focus, and theme-safe controls are scoped", async () => {
  const provider = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  const webview = await readFile(new URL("../src/webview/main.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/webview/theme.css", import.meta.url), "utf8");
  assert.match(provider, /id="pane-create"/u);
  assert.match(provider, /ensureFileNoteForUri/u);
  assert.match(provider, /case "ready":[\s\S]*else await this\.followActive\(\)/u);
  assert.match(webview, /pane\.create/u);
  assert.match(webview, /paneMode === "edit"[\s\S]*view\?\.focus/u);
  assert.match(css, /--aic-contrast-fg:[^;]*--vscode-foreground/u);
  assert.match(css, /\.aic-secondary-surface \.cm-editor \{ font-size: 0\.875rem; \}/u);
  assert.match(css, /\.aic-secondary-surface \.cm-scroller \{ line-height: 1\.42; \}/u);
});

test("release packaging includes the helper but excludes helper source", async () => {
  const ignore = await readFile(new URL("../.vscodeignore", import.meta.url), "utf8");
  assert.match(ignore, /^bridge\/\*\*$/mu);
  assert.doesNotMatch(ignore, /^bin\//mu);
  const goMod = await readFile(new URL("../bridge/go.mod", import.meta.url), "utf8");
  assert.match(goMod, /28e3820a341f/u);
  const provenance = await readFile(new URL("../PROVENANCE.md", import.meta.url), "utf8");
  assert.match(provenance, /010501fe03a0f06b114e0414caf556fee05c3418/u);
  assert.match(provenance, /7716a0d940a0f6ae8e1f3b3f4f36299dc53e31b16840dbd171254312c41ca12e/u);
});
