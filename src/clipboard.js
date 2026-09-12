// Explicit, request-scoped clipboard operations for security fields. Clipboard
// contents are never included in diagnostics or exception messages.
const READ_LIMIT = 16 * 1024; // UTF-16 code units, matching the security model.
const WRITE_LIMIT = 2 * 1024 * 1024; // UTF-8 bytes.
const REQUEST_TIMEOUT_MS = 2500;
const REQUEST_ID = /^[a-zA-Z0-9_-]{1,80}$/u;

export class ClipboardHost {
  constructor({ scope, clipboard, context, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.scope = scope;
    this.clipboard = clipboard;
    this.context = context;
    this.timeoutMs = timeoutMs;
    this.pending = new Set();
    scope.defer(() => this.pending.clear());
  }

  async handle(message, sourceWebview) {
    const requestId = message?.requestId;
    if (
      message?.type !== "clipboard.request" ||
      !REQUEST_ID.test(requestId) ||
      !["read", "write"].includes(message.action) ||
      typeof message.relativePath !== "string" ||
      !message.relativePath ||
      !Number.isSafeInteger(message.generation) ||
      (message.action === "write" && typeof message.text !== "string") ||
      (message.action === "read" && message.text !== undefined)
    )
      return;

    const { action } = message;
    const reply = (ok, error, text) => {
      if (this.scope.disposed) return;
      const response = { type: "clipboard.response", requestId, ok };
      if (error) response.error = error;
      if (action === "read" && ok) response.text = text;
      try {
        void Promise.resolve(sourceWebview.postMessage(response)).catch(() => {});
      } catch {
        // A closed webview must not surface clipboard contents elsewhere.
      }
    };
    const initial = this.context();
    const identity = initial.identity;
    const current = () => {
      const state = this.context();
      return (
        !this.scope.disposed &&
        state.webview === sourceWebview &&
        state.identity === identity &&
        state.relativePath === message.relativePath &&
        state.generation === message.generation &&
        state.hasSurface &&
        state.ready &&
        (action !== "read" || !state.readOnly)
      );
    };
    if (!current()) {
      reply(false, "stale");
      return;
    }
    if (this.pending.has(requestId) || this.pending.size >= 32) {
      reply(false, "invalid_request");
      return;
    }
    if (action === "write" && Buffer.byteLength(message.text, "utf8") > WRITE_LIMIT) {
      reply(false, "oversize");
      return;
    }

    this.pending.add(requestId);
    let timer;
    try {
      const operation = action === "read"
        ? this.clipboard.readText()
        : this.clipboard.writeText(message.text);
      const outcome = await Promise.race([
        Promise.resolve(operation).then(
          (value) => ({ ok: true, value }),
          () => ({ ok: false, error: "unavailable" }),
        ),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), this.timeoutMs);
        }),
      ]);
      if (!current()) {
        reply(false, "stale");
      } else if (!outcome.ok) {
        reply(false, outcome.error);
      } else if (action === "read") {
        if (typeof outcome.value !== "string") reply(false, "unavailable");
        else if (outcome.value.length > READ_LIMIT) reply(false, "oversize");
        else reply(true, undefined, outcome.value);
      } else {
        reply(true);
      }
    } catch {
      if (current()) reply(false, "unavailable");
    } finally {
      clearTimeout(timer);
      this.pending.delete(requestId);
    }
  }
}
