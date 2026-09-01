import * as path from "node:path";
import * as vscode from "vscode";
import { noteDescriptorForUri } from "./create.js";
import { resolveTarget } from "./target.js";

const EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**}";

function normalizedRelative(folder, uri) {
  const value = vscode.workspace.asRelativePath(uri, false).replaceAll("\\", "/");
  return value === "." ? "" : value;
}

function depthOf(value) {
  return String(value ?? "").split("/").filter(Boolean).length;
}

async function exists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function descriptorForTarget(uri, relation) {
  const descriptor = await noteDescriptorForUri(uri);
  return {
    relation,
    label: descriptor.isWorkspaceRoot ? descriptor.folder.name : path.posix.basename(descriptor.relPath),
    path: descriptor.notePath,
    targetPath: descriptor.relPath,
    depth: descriptor.isWorkspaceRoot ? 0 : depthOf(descriptor.relPath),
    exists: await exists(descriptor.noteUri),
  };
}

function relationRank(value) {
  return { project: 0, parent: 1, current: 2, component: 3, sibling: 4 }[value] ?? 5;
}

// Build a context-only view over canonical sidecars. Project/ancestor/current
// candidates are present even before their files exist; component and sibling
// rows are aliases of existing notes. Nothing here mutates Markdown or disk.
export async function noteRelationshipsForTarget(uri) {
  if (!uri || uri.scheme !== "file" || uri.path.endsWith(".note.md")) return [];
  const current = await noteDescriptorForUri(uri);
  const folder = current.folder;
  const rows = new Map();
  const add = (row) => rows.set(row.path, row);

  add(await descriptorForTarget(folder.uri, "project"));

  const parts = current.relPath.split("/").filter(Boolean);
  const ancestorParts = current.isDirectory ? parts.slice(0, -1) : parts.slice(0, -1);
  for (let index = 1; index <= ancestorParts.length; index++) {
    const ancestor = vscode.Uri.joinPath(folder.uri, ...ancestorParts.slice(0, index));
    add(await descriptorForTarget(ancestor, "parent"));
  }
  add(await descriptorForTarget(uri, "current"));

  const noteUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.note.md"),
    new vscode.RelativePattern(folder, EXCLUDE),
  );
  const currentParent = path.posix.dirname(current.relPath || ".");
  for (const noteUri of noteUris) {
    const notePath = normalizedRelative(folder, noteUri);
    if (rows.has(notePath)) continue;
    const target = await resolveTarget(folder, notePath);
    if (!target) continue;
    const targetPath = normalizedRelative(folder, target);
    let relation = "";
    if (
      current.isDirectory && current.relPath &&
      targetPath.startsWith(`${current.relPath}/`)
    ) {
      relation = "component";
    } else if (path.posix.dirname(targetPath || ".") === currentParent) {
      relation = "sibling";
    }
    if (!relation) continue;
    add({
      relation,
      label: targetPath ? path.posix.basename(targetPath) : folder.name,
      path: notePath,
      targetPath,
      depth: targetPath ? depthOf(targetPath) : 0,
      exists: true,
    });
  }

  return [...rows.values()].sort((left, right) =>
    relationRank(left.relation) - relationRank(right.relation) ||
    left.depth - right.depth ||
    left.label.localeCompare(right.label),
  );
}
