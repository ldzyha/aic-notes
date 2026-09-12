// The aic "host" facade the vendored markdown files consume, backed by
// acquireVsCodeApi() messaging. providers / ui.console are intentionally
// ABSENT — the vendored mermaid.js was adapted to not need them.

import { DisposableScope } from "../lifecycle.js";

export function makeClipboardClient(api, docState, eventTarget = window, timeoutMs = 3000) {
  const scope = new DisposableScope();
  const pending = new Map();
  let sequence = 0;
  const fail = (category) => new Error(category);

  function cancel() {
    for (const [requestId, request] of pending) {
      pending.delete(requestId);
      clearTimeout(request.timer);
      request.reject(fail("stale"));
    }
  }
  scope.defer(cancel);
  const onPageHide = () => scope.dispose();
  eventTarget.addEventListener("pagehide", onPageHide);
  scope.defer(() => eventTarget.removeEventListener("pagehide", onPageHide));

  function request(action, text) {
    if (scope.disposed || !docState.hasSurface || !docState.relativePath ||
        (action === "read" && docState.readOnly))
      return Promise.reject(fail("stale"));
    if (action === "write" && (typeof text !== "string" ||
        new TextEncoder().encode(text).length > 2 * 1024 * 1024))
      return Promise.reject(fail("oversize"));
    const requestId = `clipboard-${++sequence}`;
    const relativePath = docState.relativePath;
    const generation = docState.generation;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(fail("timeout"));
      }, timeoutMs);
      pending.set(requestId, { action, relativePath, generation, resolve, reject, timer });
      try {
        api.postMessage({
          type: "clipboard.request", requestId, action, relativePath, generation,
          ...(action === "write" ? { text } : {}),
        });
      } catch {
        pending.delete(requestId);
        clearTimeout(timer);
        reject(fail("unavailable"));
      }
    });
  }

  function handleMessage(message) {
    if (message?.type !== "clipboard.response") return false;
    const request = pending.get(message.requestId);
    if (!request) return true;
    pending.delete(message.requestId);
    clearTimeout(request.timer);
    if (scope.disposed || !docState.hasSurface ||
        docState.relativePath !== request.relativePath ||
        docState.generation !== request.generation ||
        (request.action === "read" && docState.readOnly)) {
      request.reject(fail("stale"));
    } else if (!message.ok) {
      request.reject(fail(["stale", "oversize", "unavailable", "timeout", "invalid_request"].includes(message.error)
        ? message.error : "unavailable"));
    } else if (request.action === "read") {
      if (typeof message.text !== "string" || message.text.length > 16 * 1024)
        request.reject(fail("unavailable"));
      else request.resolve(message.text);
    } else {
      request.resolve(true);
    }
    return true;
  }

  return {
    readText: () => request("read"),
    writeText: (text) => request("write", text).catch(() => false),
    handleMessage,
    cancel,
    dispose: () => scope.dispose(),
  };
}

export function makeHost(api, docState) {
  return {
    bus: {
      publish(topic, payload) {
        api.postMessage({ type: "bus", topic, payload });
      },
    },
    editor: {
      // the link action adapter resolves relative local links against the
      // "active buffer" — here, always this document
      getActiveBuffer: () => ({ path: docState.relativePath }),
    },
    listen(el, ev, fn) {
      el.addEventListener(ev, fn);
      return { dispose: () => el.removeEventListener(ev, fn) };
    },
    capabilities: {
      set(key, value) {
        api.postMessage({ type: "diagnostic", key, value });
      },
    },
    ui: {
      toast: {
        error(scope, message) {
          api.postMessage({ type: "toast", scope, message });
        },
      },
    },
  };
}
