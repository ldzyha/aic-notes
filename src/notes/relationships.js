import { isFileResource } from "./resources.js";
import * as path from "./uri-path.js";
import * as vscode from "vscode";
import { noteDescriptorForUri } from "./create.js";
import { folderNotePathFor } from "./paths.js";
import { resolveTarget } from "./target.js";
import {
  notePages,
  targetSpecificity,
} from "../../vendor/aic-editor-core/note-pages.js";

const EXCLUDE = "{**/node_modules/**,**/.git/**,**/dist/**}";

function normalizedRelative(folder, uri) {
  const value = vscode.workspace
    .asRelativePath(uri, false)
    .replaceAll("\\", "/");
  return value === "." ? "" : value;
}

function depthOf(value) {
  return String(value ?? "")
    .split("/")
    .filter(Boolean).length;
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
    label: descriptor.isWorkspaceRoot
      ? descriptor.folder.name
      : path.posix.basename(descriptor.relPath),
    path: descriptor.notePath,
    targetPath: descriptor.relPath,
    depth: descriptor.isWorkspaceRoot ? 0 : depthOf(descriptor.relPath),
    exists: await exists(descriptor.noteUri),
  };
}

function relationRank(value) {
  return (
    { project: 0, parent: 1, current: 2, component: 3, sibling: 4 }[value] ?? 5
  );
}

// Build a context-only view over canonical sidecars. Only existing notes add
// ancestor, component, or sibling rows. Project navigation and the actual
// current target remain available as placeholders; neither creates a note
// (or a sync/tag identity). Nothing here mutates Markdown or disk.
export async function noteRelationshipsForTarget(uri) {
  if (!uri || !isFileResource(uri) || uri.path.endsWith(".note.md")) return [];
  const current = await noteDescriptorForUri(uri);
  const folder = current.folder;
  const rows = new Map();
  const add = (row) => {
    // The root's identity is reserved, as in parentNoteCandidates. A child
    // named like the workspace must not relabel the project as that child.
    if (rows.get(row.path)?.relation !== "project") rows.set(row.path, row);
  };

  add({
    ...(await descriptorForTarget(folder.uri, "project")),
    isCurrent: current.isWorkspaceRoot,
  });

  const noteUris = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folder, "**/*.note.md"),
    new vscode.RelativePattern(folder, EXCLUDE),
  );
  const notePaths = new Set(
    noteUris.map((noteUri) => normalizedRelative(folder, noteUri)),
  );

  const parts = current.relPath.split("/").filter(Boolean);
  const ancestorParts = parts.slice(0, -1);
  for (let index = 1; index <= ancestorParts.length; index++) {
    const ancestorPath = ancestorParts.slice(0, index).join("/");
    if (!notePaths.has(folderNotePathFor(ancestorPath))) continue;
    const ancestor = vscode.Uri.joinPath(folder.uri, ancestorPath);
    const row = await descriptorForTarget(ancestor, "parent");
    if (row.exists) add(row);
  }
  if (!current.isWorkspaceRoot) add(await descriptorForTarget(uri, "current"));

  const currentParent = path.posix.dirname(current.relPath || ".");
  for (const noteUri of noteUris) {
    const notePath = normalizedRelative(folder, noteUri);
    if (rows.has(notePath)) continue;
    const target = await resolveTarget(folder, notePath);
    if (!target) continue;
    const targetPath = normalizedRelative(folder, target);
    let relation = "";
    if (
      current.isDirectory &&
      current.relPath &&
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

  return [...rows.values()].sort(
    (left, right) =>
      relationRank(left.relation) - relationRank(right.relation) ||
      left.depth - right.depth ||
      left.label.localeCompare(right.label),
  );
}

// Note pages: `--- <path>` binds a page of any note to a workspace path. The
// lookup runs only when the followed file has no sidecar. It lists one
// workspace folder's notes (same exclusions as relationships, capped), reads
// each note once, and keeps only its bound targets until the note changes.
const BOUND_NOTE_LIMIT = 500;
const BOUND_SCAN_MS = 1500;
const BOUND_LINE = /(?:^|\n)---[ \t]+\S/u;
const boundLists = new Map();
const boundTargets = new Map();
let boundEpoch = 0;

export function invalidateBoundNotes(uri, listChanged = false) {
  boundEpoch++;
  if (uri) boundTargets.delete(uri.toString());
  else boundTargets.clear();
  if (listChanged) boundLists.clear();
}

async function boundTargetsOf(uri, open) {
  const key = uri.toString();
  const cached = boundTargets.get(key);
  if (cached) return cached;
  const epoch = boundEpoch;
  const text =
    open.get(key)?.getText() ??
    new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  const targets = BOUND_LINE.test(text)
    ? notePages(text).flatMap((page) => (page.target ? [page.target] : []))
    : [];
  if (epoch === boundEpoch) boundTargets.set(key, targets);
  return targets;
}

async function scanBoundNotes(folder, relPath) {
  const key = folder.uri.toString();
  let list = boundLists.get(key);
  if (!list) {
    list = Promise.resolve(
      vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, "**/*.note.md"),
        new vscode.RelativePattern(folder, EXCLUDE),
        BOUND_NOTE_LIMIT,
      ),
    );
    boundLists.set(key, list);
    list.catch(() => boundLists.delete(key));
  }
  const uris = await list;
  const open = new Map(
    vscode.workspace.textDocuments.map((document) => [
      document.uri.toString(),
      document,
    ]),
  );
  const fileDir = path.posix.dirname(relPath);
  let best;
  for (let index = 0; index < uris.length; index += 16) {
    const batch = uris.slice(index, index + 16);
    const targets = await Promise.all(
      batch.map((uri) => boundTargetsOf(uri, open).catch(() => [])),
    );
    batch.forEach((uri, offset) => {
      const score = Math.max(
        0,
        ...targets[offset].map((bound) => targetSpecificity(bound, relPath)),
      );
      if (!score) return;
      const notePath = normalizedRelative(folder, uri);
      const noteDir = path.posix.dirname(notePath);
      // Ties: the note nearest above the file, then alphabetical.
      const near =
        noteDir === "."
          ? 1
          : `${fileDir}/`.startsWith(`${noteDir}/`)
            ? depthOf(noteDir) + 1
            : 0;
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (near > best.near || (near === best.near && notePath < best.path)))
      )
        best = { uri, score, near, path: notePath };
    });
  }
  return best?.uri;
}

/**
 * The note with the most specific page bound to `relPath`, or undefined.
 * When the scan outlives the timeout and later finds a note, `onLate` is
 * called once with it; the caches are warm by then.
 */
export async function boundNoteForTarget(
  folder,
  relPath,
  { onLate, timeoutMs = BOUND_SCAN_MS } = {},
) {
  const timedOut = {};
  let timer;
  try {
    const scan = scanBoundNotes(folder, relPath);
    const found = await Promise.race([
      scan,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs, timedOut);
      }),
    ]);
    if (found !== timedOut) return found;
    scan.then(
      (late) => late && onLate?.(late),
      () => {},
    );
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
