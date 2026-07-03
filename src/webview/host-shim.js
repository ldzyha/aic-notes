// The aic "host" facade the vendored markdown files consume, backed by
// acquireVsCodeApi() messaging. providers / ui.console are intentionally
// ABSENT — the vendored mermaid.js was adapted to not need them.

export function makeHost(api, docState) {
  return {
    bus: {
      publish(topic, payload) {
        api.postMessage({ type: "bus", topic, payload });
      },
    },
    editor: {
      // the vendored link-tooltip resolves relative local links against the
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
