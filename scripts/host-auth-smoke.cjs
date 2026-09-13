// Only an isolated Extension Development Host and synthetic, empty workspace.
const assert = require("node:assert/strict");
const vscode = require("vscode");
async function until(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(label);
}
exports.run = async () => {
  assert.equal(vscode.workspace.workspaceFolders?.[0]?.name, "aic-auth-smoke");
  const extension = vscode.extensions.getExtension("ldzyha.aic-notes");
  assert.equal(extension.packageJSON.version, "39.3.3");
  const api = await extension.activate();
  await until(
    () => api.getStandardNotesStatus().status === "signed-out",
    "empty profile signs out silently",
  );
  assert.deepEqual(api.getStandardNotesStatus(), {
    status: "signed-out",
    syncEnabled: false,
  });
  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "standardNotesAccount",
    "signInStandardNotes",
    "signOutStandardNotes",
    "checkStandardNotesConnection",
  ])
    assert.ok(commands.includes(`aicNotes.${command}`));
  await vscode.commands.executeCommand("aicNotes.checkStandardNotesConnection");
  const login = vscode.commands.executeCommand("aicNotes.signInStandardNotes");
  await until(
    () => api.getStandardNotesStatus().status === "signing-in",
    "native sign-in command starts",
  );
  // Let the secure-storage preflight complete and the email prompt mount, then cancel it.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
  await login;
  assert.deepEqual(api.getStandardNotesStatus(), {
    status: "signed-out",
    syncEnabled: false,
  });
  console.log(
    "AIC auth host smoke PASS: activation, commands, secure-storage read, native prompt cancellation, no account/no sync",
  );
};
