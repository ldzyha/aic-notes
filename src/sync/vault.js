import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { isAbsolute as pathIsAbsolute } from "node:path";
import { structuredError } from "../errors.js";

const VAULT_SECRET_KEY = "aicNotes.standardNotes.vaultKey.v1";
const VAULT_DIRECTORY = "standard-notes";
const VAULT_FILE = "standard-notes-session.v1.json";
const VAULT_KEY_FILE = "standard-notes-vault-key.v1";
const vaultKeyCache = new WeakMap();

function validVaultKey(value) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(String(value ?? ""))) return false;
  try {
    return Buffer.from(value, "base64url").length === 32;
  } catch {
    return false;
  }
}

async function fileBackedVaultKey(directory) {
  const keyPath = vscode.Uri.joinPath(directory, VAULT_KEY_FILE).fsPath;
  try {
    const existing = (await readFile(keyPath, "utf8")).trim();
    if (!validVaultKey(existing)) throw new Error("stored vault key is invalid");
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const generated = randomBytes(32).toString("base64url");
  try {
    const handle = await open(keyPath, "wx", 0o600);
    try {
      await handle.writeFile(`${generated}\n`, "utf8");
    } finally {
      await handle.close();
    }
    return generated;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = (await readFile(keyPath, "utf8")).trim();
    if (!validVaultKey(existing)) throw new Error("stored vault key is invalid");
    return existing;
  }
}

function localStorageDirectory(context) {
  if (context.globalStorageUri?.scheme === "file") return context.globalStorageUri;
  if (typeof context.globalStoragePath === "string" && pathIsAbsolute(context.globalStoragePath)) {
    return vscode.Uri.file(context.globalStoragePath);
  }
  return undefined;
}

export async function sessionVaultConfig(context) {
  const storageRoot = localStorageDirectory(context);
  if (!storageRoot) {
    throw structuredError("sn_vault_unavailable", "secure extension storage is unavailable", [
      "Run AIC Notes in a local VS Code or code-server extension host",
    ]);
  }
  const directory = vscode.Uri.joinPath(storageRoot, VAULT_DIRECTORY);
  await vscode.workspace.fs.createDirectory(directory);
  let vaultKey = vaultKeyCache.get(context);
  if (!validVaultKey(vaultKey)) {
    if (typeof context.secrets?.get === "function" && typeof context.secrets?.store === "function") {
      try {
        vaultKey = await context.secrets.get(VAULT_SECRET_KEY);
        if (!validVaultKey(vaultKey)) {
          const candidate = randomBytes(32).toString("base64url");
          await context.secrets.store(VAULT_SECRET_KEY, candidate);
          const confirmed = await context.secrets.get(VAULT_SECRET_KEY);
          vaultKey = confirmed === candidate ? candidate : await fileBackedVaultKey(directory);
        }
      } catch {
        vaultKey = await fileBackedVaultKey(directory);
      }
    } else {
      vaultKey = await fileBackedVaultKey(directory);
    }
    vaultKeyCache.set(context, vaultKey);
  }
  const vault = vscode.Uri.joinPath(directory, VAULT_FILE);
  return { vaultPath: vault.fsPath, vaultKey };
}

export const vaultContract = Object.freeze({
  secretKey: VAULT_SECRET_KEY,
  directory: VAULT_DIRECTORY,
  file: VAULT_FILE,
  fallbackKeyFile: VAULT_KEY_FILE,
});
