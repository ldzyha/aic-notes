/** A parent owns its subscriptions and child surfaces. Disposal is terminal,
 * idempotent, and closed children remove themselves from the parent registry. */
export class DisposableScope {
  constructor() {
    this.disposed = false;
    this.resources = new Set();
  }
  add(resource) {
    if (!resource) return resource;
    if (this.disposed) resource.dispose();
    else this.resources.add(resource);
    return resource;
  }
  defer(cleanup) {
    return this.add({ dispose: cleanup });
  }
  child() {
    const child = this.add(new DisposableScope());
    child.defer(() => this.resources.delete(child));
    return child;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of [...this.resources].reverse()) {
      this.resources.delete(resource);
      try {
        resource.dispose();
      } catch {
        /* One failed cleanup must not strand the remaining resources. */
      }
    }
  }
}
