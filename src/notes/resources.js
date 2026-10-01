import * as vscode from "vscode";

export function resourceLabel(uri) {
  return uri
    ? uri.scheme === "file"
      ? uri.fsPath
      : uri.toString()
    : "resource";
}

export function workspaceFolderFor(uri, api = vscode) {
  if (
    !uri ||
    uri.scheme === "untitled" ||
    !uri.path ||
    uri.fragment ||
    uri.path.split("/").some((part) => part === "." || part === "..")
  )
    return undefined;
  const folder = api.workspace.getWorkspaceFolder(uri);
  if (
    !folder ||
    folder.uri.scheme !== uri.scheme ||
    folder.uri.authority !== uri.authority ||
    (folder.uri.query ?? "") !== (uri.query ?? "")
  )
    return undefined;
  const root = folder.uri.path.replace(/\/$/u, "");
  return uri.path === root || uri.path.startsWith(`${root}/`)
    ? folder
    : undefined;
}

// Existing local standalone sidecars remain supported. Other schemes must be
// backed by the selected workspace; arbitrary document/content URIs stay out.
export function isFileResource(uri, api = vscode) {
  return Boolean(
    uri && (uri.scheme === "file" || workspaceFolderFor(uri, api)),
  );
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
