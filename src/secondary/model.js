import {
  appendPageText,
  normalizeTarget,
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

// A note as mergeable parts. Part 0 is the text before the first separator
// (always present, maybe empty); every later part is one separator line
// (`head`) and its page. `body` is the page without its trailing blank lines;
// those (`gap`) keep the next separator a separator and belong to the file.
// Bound parts are identified by normalized target, unbound ones by position.
function noteParts(text) {
  const pages = notePages(text);
  const parts = [];
  let unbound = 0;
  const add = (target, head, from, to) => {
    const whole = text.slice(from, to);
    const kept = whole.replace(/(?:\r?\n[ \t]*)+$/u, "");
    const body = kept.trim() ? kept : "";
    parts.push({
      key: target === null ? `u${unbound++}` : `t${normalizeTarget(target)}`,
      target,
      head,
      body,
      gap: whole.slice(body.length),
    });
  };
  add(null, "", 0, pages[0].separator < 0 ? pages[0].to : pages[0].separator);
  for (const page of pages)
    if (page.separator >= 0)
      add(
        page.target,
        text.slice(page.separator, page.content),
        page.content,
        page.to,
      );
  return parts;
}

const headLine = (head) => head.replace(/\r?\n$/u, "");
const unboundCount = (parts) =>
  parts.filter((part) => part.target === null).length;

/**
 * Page-level three-way merge of a pane draft: `draft` and `theirs` (the note
 * as it is now) both started as `base`. Returns `{ text }`, or
 * `{ conflict: "page" }` when a page changed on both sides, or
 * `{ conflict: "structure" }` when the pages cannot be matched.
 *
 * - A page only the draft changed takes the draft's body; every other byte is
 *   `theirs`, including the blank lines that end each page.
 * - A page the draft added at the end is appended when `theirs` has no page
 *   for that target.
 * - A draft that removed, renamed, reordered or inserted pages, a target used
 *   twice, or a different number of unbound pages is never merged.
 */
export function mergeDraftPages(base, theirs, draft) {
  if (theirs === base || theirs === draft) return { text: draft };
  if (draft === base) return { text: theirs };
  const structure = { conflict: "structure" };
  const was = noteParts(base);
  const now = noteParts(theirs);
  const mine = noteParts(draft);
  for (const parts of [was, now, mine])
    if (new Set(parts.map((part) => part.key)).size !== parts.length)
      return structure;
  if (
    unboundCount(now) !== unboundCount(was) ||
    unboundCount(mine) !== unboundCount(was) ||
    mine.length < was.length
  )
    return structure;
  // The draft keeps every separator line of `base`, in order, and may only
  // add pages after them.
  for (const [index, part] of was.entries())
    if (
      mine[index].key !== part.key ||
      headLine(mine[index].head) !== headLine(part.head)
    )
      return structure;
  const current = new Map(now.map((part) => [part.key, part]));
  const changed = new Map();
  for (const [index, part] of was.entries()) {
    const local = mine[index];
    if (local.body === part.body) continue;
    const their = current.get(part.key);
    if (!their) return { conflict: "page" };
    if (their.body === local.body) continue;
    if (their.body !== part.body) return { conflict: "page" };
    changed.set(part.key, local);
  }
  const added = mine.slice(was.length);
  if (added.some((part) => current.has(part.key))) return { conflict: "page" };

  const eol = theirs.includes("\r\n") ? "\r\n" : "\n";
  let text = "";
  for (const [index, part] of now.entries()) {
    const local = changed.get(part.key);
    if (!local) {
      text += part.head + part.body + part.gap;
      continue;
    }
    let { head, gap } = part;
    if (local.body && !part.body) {
      // An empty page has no line end of its own: the separator line gets
      // one, and the page keeps a blank line before the next separator.
      if (head && !/\n$/u.test(head)) head += eol;
      if (index === now.length - 1) gap = local.gap;
      else if (gap.split("\n").length < 3)
        gap = eol + (gap.includes("\n") ? gap : eol);
      else gap = eol + gap;
    }
    text += head + local.body + gap;
  }
  for (const part of added) {
    const separator = appendPageText(text, part.target);
    if (!separator) return structure;
    text += separator + part.body + part.gap;
  }

  // The result must read back as the pages of `theirs` plus the added ones,
  // each with the expected text; otherwise nothing is merged.
  const result = noteParts(text);
  const expected = [...now, ...added];
  if (result.length !== expected.length) return structure;
  for (const [index, part] of expected.entries()) {
    const read = result[index];
    const local = changed.get(part.key);
    if (read.key !== part.key) return structure;
    if (
      read.body !== (local ?? part).body ||
      (index < now.length && headLine(read.head) !== headLine(part.head))
    )
      return structure;
  }
  return { text };
}
