import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
const index = await readFile(new URL("FUNCTIONAL_INDEX.md", root), "utf8");
const registrations = [
  await readFile(new URL("src/extension.js", root), "utf8"),
  await readFile(new URL("src/agents/bootstrap.js", root), "utf8"),
].join("\n");

test("every public command is registered and indexed", () => {
  for (const { command } of manifest.contributes.commands) {
    assert.ok(index.includes("`" + command + "`"), command + " is not indexed");
    assert.ok(
      registrations.includes(`"${command}"`),
      `${command} is not registered`,
    );
  }
  for (const retired of [
    "aicNotes.openNote",
    "aicNotes.openTarget",
    "aicNotes.refreshTree",
    "aicNotes.copyWikiLink",
    "aicNotes.deleteNote",
    "aicNotes.deleteFolderNotes",
  ]) {
    assert.ok(
      !manifest.contributes.commands.some(({ command }) => command === retired),
    );
    assert.ok(!registrations.includes(`"${retired}"`));
    assert.ok(!index.includes("`" + retired + "`"));
  }
});

test("functional index records the release-critical state contracts", () => {
  for (const contract of [
    "Ctrl/Cmd+S",
    "active custom-editor tab is authoritative",
    "Pinning affects only automatic following",
    "Secondary headers do not display file dates",
    "No Standard Notes account connection is offered by the VS Code extension",
    "One universal VSIX",
    "Trash is local",
    "Slash on an otherwise empty Markdown line",
  ])
    assert.ok(index.includes(contract), `missing contract: ${contract}`);
});
