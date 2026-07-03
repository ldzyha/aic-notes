// makePreviewTracker — the mermaid preview caret state machine. Pure and
// timer-injected, so the debounce is driven by a fake clock.

import test from "node:test";
import assert from "node:assert/strict";
import { makePreviewTracker } from "../src/webview/mermaid-preview.js";

function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    pending: () => timers.size,
  };
}

function makeHarness() {
  const clock = fakeClock();
  const sent = [];
  const tracker = makePreviewTracker((kind, payload) => sent.push({ kind, payload }), {
    debounceMs: 300,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, sent, tracker };
}

const fence = (from, source) => ({ from, source });

test("entering a fence emits update immediately", () => {
  const { sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  assert.deepEqual(sent, [{ kind: "update", payload: { source: "flowchart TD", fenceFrom: 10 } }]);
});

test("no fence and nothing open emits nothing", () => {
  const { sent, tracker } = makeHarness();
  tracker.update(null);
  assert.deepEqual(sent, []);
});

test("caret moves within the same unchanged fence emit nothing", () => {
  const { sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD"));
  assert.equal(sent.length, 1);
});

test("same-fence typing coalesces into one trailing update at 300ms", () => {
  const { clock, sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD\nA"));
  clock.advance(100);
  tracker.update(fence(10, "flowchart TD\nA --> B"));
  clock.advance(299);
  assert.equal(sent.length, 1, "still only the enter update before the debounce fires");
  clock.advance(1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], {
    kind: "update",
    payload: { source: "flowchart TD\nA --> B", fenceFrom: 10 },
  });
});

test("switching fences mid-debounce updates immediately and cancels the timer", () => {
  const { clock, sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD\nA"));
  tracker.update(fence(90, "sequenceDiagram"));
  assert.equal(sent.length, 2, "fence switch is synchronous");
  assert.deepEqual(sent[1], { kind: "update", payload: { source: "sequenceDiagram", fenceFrom: 90 } });
  assert.equal(clock.pending(), 0, "the stale same-fence debounce is cancelled");
  clock.advance(1000);
  assert.equal(sent.length, 2, "no trailing update from the abandoned fence");
});

test("leaving fences emits one close", () => {
  const { sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(null);
  tracker.update(null);
  assert.deepEqual(
    sent.map((s) => s.kind),
    ["update", "close"],
  );
});

test("leaving while a debounce is pending drops the trailing update", () => {
  const { clock, sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD\nA"));
  tracker.update(null);
  clock.advance(1000);
  assert.deepEqual(
    sent.map((s) => s.kind),
    ["update", "close"],
  );
});

test("re-entering after leave emits update again", () => {
  const { sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(null);
  tracker.update(fence(10, "flowchart TD"));
  assert.deepEqual(
    sent.map((s) => s.kind),
    ["update", "close", "update"],
  );
});

test("close() clears state without emitting", () => {
  const { clock, sent, tracker } = makeHarness();
  tracker.update(fence(10, "flowchart TD"));
  tracker.update(fence(10, "flowchart TD\nA"));
  tracker.close();
  clock.advance(1000);
  assert.equal(sent.length, 1, "no close message and no trailing debounce");
  tracker.update(fence(10, "flowchart TD\nA"));
  assert.equal(sent.length, 2, "the same fence re-enters as a fresh open");
});
