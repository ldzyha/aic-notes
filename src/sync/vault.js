import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { structuredError } from "../errors.js";

const VAULT_SECRET_KEY = "aicNotes.standardNotes.vaultKey.v1";
const VAULT_DIRECTORY = "standard-notes";
const VAULT_FILE = "standard-notes-session.v1.json";

function validVaultKey(value) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(String(value ?? ""))) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

export async function sessionVaultConfig(context) {
  if (context.globalStorageUri?.scheme !== "file" || !context.secrets) {
    throw structuredError("sn_vault_unavailable", "secure extension storage is unavailable", [
      "Run AIC Notes in VS Code or code-server with SecretStorage support",
    ]);
  }
  let vaultKey = await context.secrets.get(VAULT_SECRET_KEY);
  if (!validVaultKey(vaultKey)) {
    vaultKey = randomBytes(32).toString("base64url");
    await context.secrets.store(VAULT_SECRET_KEY, vaultKey);
  }
  const directory = vscode.Uri.joinPath(context.globalStorageUri, VAULT_DIRECTORY);
  await vscode.workspace.fs.createDirectory(directory);
  const vault = vscode.Uri.joinPath(directory, VAULT_FILE);
  return { vaultPath: vault.fsPath, vaultKey };
}

export const vaultContract = Object.freeze({
  secretKey: VAULT_SECRET_KEY,
  directory: VAULT_DIRECTORY,
  file: VAULT_FILE,
});
