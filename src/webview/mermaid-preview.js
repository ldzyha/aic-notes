// Caret→preview tracker — the state-machine half of the mermaid live preview
// (aic makeMermaidPreview semantics, modules/markdown/web/src/mermaid.js
// ~1378-1396, render-only). Pure and CM-free so node:test can drive it with
// fake timers; the DOM/panel halves live in preview.js and
// src/preview/manager.js.
//
// Semantics: no fence at the caret → one "close"; entering a fence or moving
// to a DIFFERENT fence (identity = fence.from) → immediate "update"; a source
// change within the SAME fence → one trailing debounced "update" (~300ms,
// keystrokes coalesce); a caret move within the fence that changes nothing
// emits nothing.

export function makePreviewTracker(
  send,
  { debounceMs = 300, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  let open = false;
  let lastFrom = null;
  let lastSource = null;
  let timer = null;

  const clear = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const reset = () => {
    clear();
    open = false;
    lastFrom = null;
    lastSource = null;
  };

  return {
    update(fence) {
      if (!fence) {
        if (open) {
          reset();
          send("close", {});
        } else {
          clear();
        }
        return;
      }
      if (!open || fence.from !== lastFrom) {
        // enter / adopt another fence: synchronous, so a fence switch can
        // never render the previous fence's stale debounced source
        clear();
        open = true;
        lastFrom = fence.from;
        lastSource = fence.source;
        send("update", { source: fence.source, fenceFrom: fence.from });
        return;
      }
      if (fence.source === lastSource) return; // caret move only
      lastFrom = fence.from;
      lastSource = fence.source;
      clear();
      timer = setTimer(() => {
        timer = null;
        send("update", { source: lastSource, fenceFrom: lastFrom });
      }, debounceMs);
    },
    close() {
      reset();
    },
  };
}
