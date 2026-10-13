import { DraftSession } from "../../vendor/aic-editor-core/draft-session.js";
import { mergeDraftPages } from "../secondary/model.js";

// VS Code's sidecar adapter owns request/path correlation; the shared core
// continues to own the explicit-save draft lifecycle.
export class SecondaryDraft {
  #session = new DraftSession();
  #path = "";
  #requestId = 0;
  #commit = null;
  #requested = false;
  // The host text this draft was typed on, and whether the host has moved on
  // from it. A stale draft sends its base so the host can rebase it.
  #base = "";
  #stale = false;

  get current() {
    return this.#session.current;
  }
  get dirty() {
    return this.#session.dirty;
  }
  get pending() {
    return this.#commit !== null;
  }
  get queued() {
    return this.#requested;
  }
  get stale() {
    return this.#stale;
  }

  /** The host text changed while this draft holds unsaved or pending input. */
  hostChanged() {
    this.#stale = true;
  }

  hydrate(text, generation, options = {}) {
    const accepted = this.#session.hydrate(text, generation, options);
    if (accepted) {
      if (typeof options.relativePath === "string")
        this.#path = options.relativePath;
      this.#commit = null;
      this.#requested = false;
      this.#base = String(text ?? "");
      this.#stale = false;
    }
    return accepted;
  }

  edit(text) {
    return this.#session.edit(text);
  }

  begin(reason = "explicit") {
    if (this.#commit || !this.#path) return null;
    const commit = this.#session.begin(reason);
    if (!commit) return null;
    this.#commit = Object.freeze({
      ...commit,
      ...(this.#stale ? { base: this.#base } : {}),
      requestId: ++this.#requestId,
      relativePath: this.#path,
    });
    return this.#commit;
  }

  request(reason = "explicit") {
    if (this.#commit) {
      if (this.current !== this.#commit.text) this.#requested = true;
      return null;
    }
    return this.begin(reason);
  }

  takeQueued() {
    const requested = this.#requested && this.dirty && !this.pending;
    this.#requested = false;
    return requested;
  }

  acknowledge(message) {
    const commit = this.#commit;
    if (
      !commit ||
      message.requestId !== commit.requestId ||
      message.relativePath !== commit.relativePath ||
      this.#path !== commit.relativePath
    )
      return false;
    if (message.saved === true && typeof message.text === "string") {
      // The host may have saved a rebased text. Input typed after the commit
      // is carried onto it: as one textual hunk, or page by page when the
      // host's rebase changed text on both sides of it. Input that cannot be
      // carried stays a stale draft on the committed text, so it can never
      // replace the host's text.
      const merged =
        mergeDraftText(commit.text, message.text, this.current) ??
        mergeDraftPages(commit.text, message.text, this.current).text ??
        null;
      if (merged === null) {
        this.#session.acknowledge({ ...message, text: commit.text });
        this.#base = commit.text;
        this.#stale = true;
      } else {
        this.#session.edit(merged);
        this.#session.acknowledge(message);
        this.#base = message.text;
        this.#stale = false;
      }
    } else this.#session.acknowledge(message);
    this.#commit = null;
    if (!message.saved) this.#requested = false;
    return true;
  }
}

export function secondarySaveState({
  dirty,
  pending,
  placeholder,
  hasSurface = true,
}) {
  if (!hasSurface) return "unavailable";
  if (dirty || pending) return "dirty";
  return placeholder ? "placeholder" : "saved";
}

export function minimalTextChange(current, next) {
  if (current === next) return null;
  let from = 0;
  while (
    from < current.length &&
    from < next.length &&
    current[from] === next[from]
  )
    from++;
  let to = current.length;
  let nextTo = next.length;
  while (to > from && nextTo > from && current[to - 1] === next[nextTo - 1]) {
    to--;
    nextTo--;
  }
  return { from, to, insert: next.slice(from, nextTo) };
}

/**
 * Rebase of input typed during a save: `mine` started as the committed text
 * `base`, which the host saved as `theirs`. Returns `theirs` with that input,
 * byte-exact, or null when the single changed ranges touch or overlap. A file
 * changed by someone else is merged by pages (mergeDraftPages), never here.
 */
export function mergeDraftText(base, theirs, mine) {
  if (theirs === mine) return mine;
  const host = minimalTextChange(base, theirs);
  if (!host) return mine;
  const local = minimalTextChange(base, mine);
  if (!local) return theirs;
  const shift = host.insert.length - (host.to - host.from);
  let from;
  if (local.to < host.from) from = local.from;
  else if (local.from > host.to) from = local.from + shift;
  else return null;
  return (
    theirs.slice(0, from) +
    local.insert +
    theirs.slice(from + local.to - local.from)
  );
}
