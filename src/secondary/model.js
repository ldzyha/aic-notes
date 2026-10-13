import {
  appendPageText,
  notePages,
  pageForTarget,
} from "../../vendor/aic-editor-core/note-pages.js";

// One note file per workspace folder. Every other file of that folder is a
// page inside it, bound by a `--- <folder-relative path>` separator line.
export const WORKSPACE_NOTE = "aic.md";

function relativeTo(folderUri, uri) {
  const root = String(folderUri?.path ?? "").replace(/\/+$/u, "");
  const value = String(uri?.path ?? "");
  return value.startsWith(`${root}/`) ? value.slice(root.length + 1) : "";
}

/** True for `<workspaceFolder>/aic.md` itself (never for a nested aic.md). */
export function isWorkspaceNote(folderUri, uri) {
  return relativeTo(folderUri, uri).toLowerCase() === WORKSPACE_NOTE;
}

/**
 * Page target of a file inside its workspace folder: the folder-relative path
 * with `/`. Null for the folder itself, the note itself and outside paths, so
 * the note can never become a page of itself.
 */
export function pageTargetFor(folderUri, uri) {
  const target = relativeTo(folderUri, uri);
  return !target || target.toLowerCase() === WORKSPACE_NOTE ? null : target;
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

export function activeWindowResource(window) {
  const tab = window.tabGroups?.activeTabGroup?.activeTab;
  return activeResource(
    tab?.input?.uri ?? tab?.input?.modified,
    window.activeTextEditor?.document?.uri,
    Boolean(tab),
  );
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

// Navigation requests arrive from several VS Code event streams. Serializing
// them prevents a slower file-stat/open operation from overtaking the user's
// latest tab or explicit context selection. A rejected request never poisons the queue.
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

/**
 * A draft typed into the empty placeholder, moved onto the note that appeared
 * on disk meanwhile: `text` plus the draft's pages appended, never changing a
 * byte of `text`. Null when the draft has text outside a page or `text`
 * already has a page for one of its targets.
 */
export function appendDraftPages(text, draft) {
  const existing = notePages(text);
  let next = text;
  for (const page of notePages(draft)) {
    if (page.target === null || pageForTarget(existing, page.target) >= 0)
      return null;
    const separator = appendPageText(next, page.target);
    if (!separator) return null;
    next += separator + draft.slice(page.content, page.to);
  }
  return next;
}
