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
  return path.posix.basename(relativePath, NOTE_SUFFIX) || "AIC note";
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

// CodeMirror change coordinates refer to the same pre-transaction document.
// Applying validated, non-overlapping ranges from right to left produces the
// exact first edited placeholder bytes without creating an intermediate file.
export function applyTextChanges(value, changes) {
  const source = String(value ?? "");
  const ordered = [...changes]
    .map((change) => ({
      from: Number(change?.from),
      to: Number(change?.to),
      insert: String(change?.insert ?? ""),
    }))
    .sort((left, right) => right.from - left.from || right.to - left.to);
  let boundary = source.length;
  let output = source;
  for (const change of ordered) {
    if (
      !Number.isInteger(change.from) ||
      !Number.isInteger(change.to) ||
      change.from < 0 ||
      change.to < change.from ||
      change.to > source.length ||
      change.to > boundary
    ) {
      throw new RangeError(
        "text changes must be valid non-overlapping source ranges",
      );
    }
    output =
      output.slice(0, change.from) + change.insert + output.slice(change.to);
    boundary = change.from;
  }
  return output;
}

export function threeWayDecision(
  localHash,
  remoteHash,
  baseHash,
  resolution = "",
) {
  if (!baseHash) return remoteHash ? "conflict" : "push";
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
