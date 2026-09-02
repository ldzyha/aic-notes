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
export function activeResource(
  activeTabUri,
  activeEditorUri,
  activeTabPresent = activeTabUri !== undefined,
) {
  // A Welcome/settings/terminal tab is an active tab but not an active file
  // buffer. Do not revive VS Code's stale native editor in that state.
  return activeTabPresent ? activeTabUri : activeEditorUri;
}

export function preferredWorkspaceFolder(
  candidateUris,
  workspaceFolders,
  resolveFolder,
) {
  for (const uri of candidateUris ?? []) {
    if (!uri) continue;
    const folder = resolveFolder?.(uri);
    if (folder) return folder;
  }
  return workspaceFolders?.[0];
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
