/** Extension-host-only edit leases. One note may be visible in several places,
 * but only one surface may mutate it. No persistence, settings or filesystem. */
export class NoteEditOwnership {
  constructor() {
    this.surfaces = new Set();
    this.owners = new Map();
    this.waiting = new Map();
    this.probing = new Set();
    this.epoch = 0;
    this.queue = Promise.resolve();
  }

  register(surface) {
    this.surfaces.add(surface);
    return surface;
  }

  key(surface) {
    return surface.uri()?.toString();
  }

  state(surface) {
    const owned = this.owners.get(this.key(surface));
    return {
      readOnly: owned?.surface !== surface || this.probing.has(surface),
      lease: owned?.epoch ?? 0,
    };
  }

  accepts(surface, lease) {
    const owned = this.owners.get(this.key(surface));
    // Pausing the UI for a probe must not reject earlier in-flight mutations
    // from that same owner. They drain before snapshot comparison/transfer.
    return (
      owned?.surface === surface &&
      Number.isSafeInteger(lease) &&
      owned.epoch === lease
    );
  }

  notify() {
    for (const surface of this.surfaces) {
      try {
        Promise.resolve(surface.notify(this.state(surface))).catch(
          () => undefined,
        );
      } catch {
        /* Disposed surface: never fail another surface's lease. */
      }
    }
  }

  activate(surface) {
    const operation = this.queue.then(() => this.acquire(surface));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async acquire(surface) {
    const key = this.key(surface);
    if (!key || !this.surfaces.has(surface)) return false;
    const previous = this.owners.get(key)?.surface;
    if (previous === surface) {
      this.waiting.delete(key);
      this.notify();
      return true;
    }
    if (previous) {
      this.waiting.set(key, surface);
      if (previous.dirty()) {
        this.notify();
        return false;
      }
      // Pause the old client before taking its snapshot. This message barrier
      // catches optimistic edits still in flight instead of dropping them on
      // a focus change. Timeout/unavailable client never grants a lease.
      let snapshot;
      this.probing.add(previous);
      this.notify();
      try {
        snapshot = await previous.probe();
      } catch {
        snapshot = null;
      } finally {
        this.probing.delete(previous);
      }
      if (
        !snapshot ||
        snapshot.dirty ||
        previous.dirty() ||
        snapshot.text !== previous.text()
      ) {
        this.notify();
        return false;
      }
    }
    if (!this.surfaces.has(surface) || this.key(surface) !== key) {
      this.notify();
      return false;
    }
    for (const [otherKey, owned] of this.owners) {
      if (owned.surface === surface && otherKey !== key)
        this.owners.delete(otherKey);
    }
    this.owners.set(key, { surface, epoch: ++this.epoch });
    this.waiting.delete(key);
    this.notify();
    return true;
  }

  changed(surface) {
    const key = this.key(surface);
    const waiting = this.waiting.get(key);
    this.notify();
    if (waiting && !surface.dirty()) return this.activate(waiting);
    return Promise.resolve(false);
  }

  dispose(surface) {
    this.surfaces.delete(surface);
    for (const [key, owned] of this.owners) {
      if (owned.surface === surface) this.owners.delete(key);
    }
    for (const [key, waiting] of this.waiting) {
      if (waiting === surface) this.waiting.delete(key);
      else void this.activate(waiting);
    }
    this.notify();
  }
}
