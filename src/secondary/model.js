import * as path from "node:path";
import { createHash } from "node:crypto";
import { notePathFor } from "../notes/paths.js";

export const NOTE_SUFFIX = ".note.md";
export const MARKDOWN_SUFFIX = ".md";

export function isNotePath(value) {
  return String(value ?? "")
    .replaceAll("\\", "/")
    .endsWith(NOTE_SUFFIX);
}

export function markdownKind(value) {
  const normalized = String(value ?? "")
    .replaceAll("\\", "/")
    .toLowerCase();
  if (!normalized.endsWith(MARKDOWN_SUFFIX)) return null;
  return normalized.endsWith(NOTE_SUFFIX) ? "note" : "document";
}

export function linkedNotePath(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  return isNotePath(normalized) ? normalized : notePathFor(normalized);
}

// VS Code can keep activeTextEditor pointed at the last native editor while a
// custom-editor tab is active. The active tab is therefore authoritative and
// the text editor is only a fallback.
export function activeResource(activeTabUri, activeEditorUri) {
  return activeTabUri ?? activeEditorUri;
}

export function paneCapabilities({
  hasDocument = false,
  hasPlaceholder = false,
  hasSource = false,
} = {}) {
  const hasSurface = Boolean(hasDocument || hasPlaceholder);
  return Object.freeze({
    hasSurface,
    canPin: Boolean(hasSurface || hasSource),
    canOpenTarget: Boolean(hasSource),
    canTrash: Boolean(hasDocument),
  });
}

// Navigation requests arrive from several VS Code event streams. Serializing
// them prevents a slower file-stat/open operation from overtaking the user's
// latest tab or tree selection. A rejected request never poisons the queue.
export class NavigationQueue {
  constructor() {
    this.tail = Promise.resolve();
  }

  enqueue(task) {
    if (typeof task !== "function")
      return Promise.reject(
        new TypeError("navigation task must be a function"),
      );
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function workspaceStateKey(uri) {
  return `aicNotes.standardNotes.${createHash("sha256").update(uri.toString()).digest("hex")}`;
}

export function noteTitle(relativePath, markdown = "") {
  if (markdownKind(relativePath) === "document") {
    return path.posix.basename(relativePath) || "Markdown document";
  }
  const frontmatterTitle =
    /^---\s*\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?^(?:---|\.\.\.)\s*$/mu.exec(
      markdown,
    )?.[1];
  if (frontmatterTitle?.trim()) return frontmatterTitle.trim();
  return path.posix.basename(relativePath) || "AIC note";
}

export function managedTagPath(
  folderName,
  parentPath,
  supportsNestedTags = true,
) {
  const project = String(folderName ?? "").trim() || "workspace";
  const parents = String(parentPath ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .map((value) => value.trim())
    .filter((value) => value && value !== ".");
  return supportsNestedTags ? [project, ...parents] : [project];
}

export function threeWayDecision(
  localHash,
  remoteHash,
  baseHash,
  resolution = "",
) {
  if (!baseHash) {
    if (!remoteHash) return "push";
    return localHash === remoteHash ? "noop" : "conflict";
  }
  const localChanged = localHash !== baseHash;
  const remoteChanged = remoteHash !== baseHash;
  if (!localChanged && !remoteChanged) return "noop";
  if (localChanged && !remoteChanged) return "push";
  if (!localChanged && remoteChanged) return "pull";
  if (localHash === remoteHash) return "noop";
  if (resolution === "local") return "push";
  if (resolution === "remote") return "pull";
  return "conflict";
}
