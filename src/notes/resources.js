import * as vscode from "vscode";

export function resourceLabel(uri) {
  return uri
    ? uri.scheme === "file"
      ? uri.fsPath
      : uri.toString()
    : "resource";
}

export function assertWritableResource(uri, api = vscode) {
  if (resourceReadOnly(uri, api)) {
    throw new Error(
      "This filesystem is read-only or unavailable. Open a writable workspace to save AIC notes.",
    );
  }
}

export function resourceReadOnly(uri, api = vscode) {
  if (!uri || uri.scheme === "untitled") return false;
  const writable = api.workspace.fs.isWritableFileSystem?.(uri.scheme);
  return writable === false || (uri.scheme !== "file" && writable !== true);
}
