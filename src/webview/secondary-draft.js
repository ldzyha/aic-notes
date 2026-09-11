import { DraftSession } from "../../vendor/aic-editor-core/draft-session.js";

// VS Code's sidecar adapter owns request/path correlation; the shared core
// continues to own the explicit-save draft lifecycle.
export class SecondaryDraft {
  #session = new DraftSession();
  #path = "";
  #requestId = 0;
  #commit = null;

  get current() {
    return this.#session.current;
  }
  get dirty() {
    return this.#session.dirty;
  }
  get pending() {
    return this.#commit !== null;
  }

  hydrate(text, generation, options = {}) {
    const accepted = this.#session.hydrate(text, generation, options);
    if (accepted) {
      if (typeof options.relativePath === "string")
        this.#path = options.relativePath;
      this.#commit = null;
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
      requestId: ++this.#requestId,
      relativePath: this.#path,
    });
    return this.#commit;
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
    // Property timestamps are normalized by the host during save. Only adopt
    // that normalized text when no newer input exists; newer edits stay local.
    if (
      message.saved === true &&
      this.current === commit.text &&
      typeof message.text === "string"
    )
      this.#session.edit(message.text);
    this.#session.acknowledge(message);
    this.#commit = null;
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
