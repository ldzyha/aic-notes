import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("3.4.0 manifest separates Primary management from Secondary note content", () => {
  assert.equal(packageJson.version, "3.4.0");
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

test("release packaging includes the helper but excludes helper source", async () => {
  const ignore = await readFile(new URL("../.vscodeignore", import.meta.url), "utf8");
  assert.match(ignore, /^bridge\/\*\*$/mu);
  assert.doesNotMatch(ignore, /^bin\//mu);
  const goMod = await readFile(new URL("../bridge/go.mod", import.meta.url), "utf8");
  assert.match(goMod, /3e1eadbafef0/u);
  const provenance = await readFile(new URL("../PROVENANCE.md", import.meta.url), "utf8");
  assert.match(provenance, /010501fe03a0f06b114e0414caf556fee05c3418/u);
  assert.match(provenance, /7716a0d940a0f6ae8e1f3b3f4f36299dc53e31b16840dbd171254312c41ca12e/u);
});
