import * as path from "node:path";
import { createHash } from "node:crypto";
import { notePathFor } from "../notes/paths.js";

export const NOTE_SUFFIX = ".note.md";

export function isNotePath(value) {
  return String(value ?? "").replaceAll("\\", "/").endsWith(NOTE_SUFFIX);
}

export function linkedNotePath(relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  return isNotePath(normalized) ? normalized : notePathFor(normalized);
}

export function workspaceStateKey(uri) {
  return `aicNotes.standardNotes.${createHash("sha256").update(uri.toString()).digest("hex")}`;
}

export function noteTitle(relativePath, markdown = "") {
  const frontmatterTitle = /^---\s*\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?^(?:---|\.\.\.)\s*$/mu.exec(
    markdown,
  )?.[1];
  if (frontmatterTitle?.trim()) return frontmatterTitle.trim();
  return path.posix.basename(relativePath, NOTE_SUFFIX) || "AIC note";
}

export function managedTags(folderName, parentPath) {
  const project = String(folderName ?? "").trim();
  const parent = String(parentPath ?? "").replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  return ["aic", `project:${project || "workspace"}`, `path:${parent || "."}`];
}

export function reconcileTagNames(existing, required) {
  const managed = (value) =>
    value === "aic" || value.startsWith("project:") || value.startsWith("path:");
  return [
    ...new Set([
      ...existing.filter((value) => !managed(value)),
      ...required,
    ]),
  ];
}

export function threeWayDecision(localHash, remoteHash, baseHash, resolution = "") {
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
