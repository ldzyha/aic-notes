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
  assert.match(index, /`aicNotes\.openNote`/u);
  assert.match(registrations, /"aicNotes\.openNote"/u);
});

test("functional index records the release-critical state contracts", () => {
  for (const contract of [
    "Ctrl/Cmd+S",
    "active custom-editor tab is authoritative",
    "Pinning affects only automatic following",
    "file`, `created`, and `updated",
    "There is no Standard Notes authorization",
    "One universal VSIX",
    "Trash is local",
    "Slash on an otherwise empty Markdown line",
  ])
    assert.ok(index.includes(contract), `missing contract: ${contract}`);
});
