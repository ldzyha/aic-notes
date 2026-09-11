// Run only in an isolated VS Code Extension Development Host with the synthetic
// fixture below. Never points at the user's project or normal VS Code profile.
const assert = require("node:assert/strict");
const vscode = require("vscode");

async function until(check, description) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(description);
}

exports.run = async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.equal(folder?.name, "aic-routing-smoke");
  const extension = vscode.extensions.getExtension("ldzyha.aic-notes");
  assert.ok(extension, "development extension exists");
  await extension.activate();
  const note = vscode.Uri.joinPath(folder.uri, "sample.note.md");
  const source = vscode.Uri.joinPath(folder.uri, "sample.js");
  const mainNote = (type) =>
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputCustom &&
          tab.input.uri.toString() === note.toString() &&
          tab.input.viewType === type,
      ),
    );

  await vscode.commands.executeCommand(
    "vscode.openWith",
    note,
    "aicNotes.markdown",
    { preview: false },
  );
  await until(
    () => mainNote("aicNotes.markdown"),
    "note remains in the main custom editor",
  );
  await vscode.commands.executeCommand(
    "workbench.action.focusActiveEditorGroup",
  );
  assert.ok(
    mainNote("aicNotes.markdown"),
    "focusing main note does not redirect or close it",
  );

  await vscode.commands.executeCommand("aicNotes.openSource", note);
  await until(
    () =>
      vscode.window.tabGroups.all.some((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === source.toString(),
        ),
      ),
    "explicit Open Source opens the backing file",
  );
  assert.ok(
    mainNote("aicNotes.markdown"),
    "Open Source does not close the existing note tab",
  );

  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  await vscode.commands.executeCommand(
    "vscode.openWith",
    note,
    "aicNotes.noteRedirect",
    { preview: false },
  );
  await until(
    () => mainNote("aicNotes.noteRedirect"),
    "persisted legacy association hosts the main editor",
  );
  await vscode.commands.executeCommand(
    "workbench.action.focusActiveEditorGroup",
  );
  assert.ok(
    mainNote("aicNotes.noteRedirect"),
    "legacy alias no longer disposes its own panel",
  );
  console.log(
    "AIC routing host smoke: main notes, explicit source action, legacy association PASS",
  );
};
