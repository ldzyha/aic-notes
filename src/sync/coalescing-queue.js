export function mergeSyncRequests(previous, next) {
  return {
    uri: next.uri ?? previous.uri,
    interactive: Boolean(previous.interactive || next.interactive),
    markdown: typeof next.markdown === "string" ? next.markdown : previous.markdown,
  };
}

// One runner per key, with at most one latest pending value behind it. This
// prevents overlapping bridge processes while save+blur bursts collapse to
// the newest persisted Markdown and retain any explicit interactive request.
export class CoalescingQueue {
  constructor(run, merge = (_previous, next) => next) {
    this.run = run;
    this.merge = merge;
    this.entries = new Map();
  }

  enqueue(key, value) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { pending: undefined, running: undefined };
      this.entries.set(key, entry);
    }
    entry.pending = entry.pending === undefined ? value : this.merge(entry.pending, value);
    if (!entry.running) {
      entry.running = (async () => {
        try {
          while (entry.pending !== undefined) {
            const next = entry.pending;
            entry.pending = undefined;
            await this.run(key, next);
          }
        } finally {
          this.entries.delete(key);
        }
      })();
    }
    return entry.running;
  }
}
