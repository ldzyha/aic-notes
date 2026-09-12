// The primary editor streams edits to TextDocument; only save acknowledgements
// establish a saved state. A queued request stays bound to this note identity.
export class PrimarySave {
  current = "";
  dirty = false;
  pending = null;
  queued = false;
  path = "";
  serial = 0;

  reset(path, text, dirty = false) {
    this.path = path;
    this.current = text;
    this.dirty = Boolean(dirty);
    this.pending = null;
    this.queued = false;
  }

  edit(text) {
    this.current = text;
    this.dirty = true;
  }

  request(reason = "explicit") {
    if (this.pending) {
      if (this.current !== this.pending.text) this.queued = true;
      return null;
    }
    if (!this.path || !this.dirty) return null;
    this.pending = {
      requestId: ++this.serial,
      relativePath: this.path,
      text: this.current,
      reason,
    };
    return this.pending;
  }

  acknowledge(message) {
    if (
      !this.pending ||
      message.requestId !== this.pending.requestId ||
      message.relativePath !== this.path
    )
      return false;
    this.pending = null;
    this.dirty = !message.saved || this.current !== message.text;
    if (!message.saved) this.queued = false;
    return true;
  }

  externallySaved(text) {
    if (this.current === text && !this.pending) this.dirty = false;
  }

  takeQueued() {
    const requested = this.queued && this.dirty && !this.pending;
    this.queued = false;
    return requested;
  }
}
