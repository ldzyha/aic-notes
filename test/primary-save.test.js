import test from "node:test";
import assert from "node:assert/strict";
import { PrimarySave } from "../src/webview/primary-save.js";

test("primary save waits for its ACK, queues a requested newer draft and stays dirty for intervening input", () => {
  const state = new PrimarySave();
  state.reset("one.md", "base");
  state.edit("first");
  const first = state.request();
  assert.equal(state.dirty, true);
  state.edit("second");
  assert.equal(state.request(), null);
  assert.equal(
    state.acknowledge({ ...first, text: "first", saved: true }),
    true,
  );
  assert.equal(state.dirty, true);
  assert.equal(state.takeQueued(), true);
  const second = state.request();
  assert.equal(second.text, "second");
  assert.equal(state.acknowledge({ ...first, saved: true }), false);
  state.acknowledge({ ...second, saved: true });
  assert.equal(state.dirty, false);
});

test("primary raw input never queues a save, failure retains retry, and note changes reject stale ACKs", () => {
  const state = new PrimarySave();
  state.reset("one.md", "base");
  state.edit("first");
  const first = state.request();
  state.edit("typed later");
  state.acknowledge({ ...first, saved: true });
  assert.equal(state.takeQueued(), false);
  assert.equal(state.dirty, true);
  const retry = state.request();
  state.acknowledge({ ...retry, saved: false });
  assert.equal(state.dirty, true);
  const old = state.request();
  state.reset("two.md", "first", true);
  assert.equal(state.acknowledge({ ...old, saved: true }), false);
  assert.equal(state.dirty, true);
  assert.equal(state.pending, null);
  state.externallySaved("different");
  assert.equal(state.dirty, true);
  state.externallySaved("first");
  assert.equal(state.dirty, false);
});
