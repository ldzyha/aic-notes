import test from "node:test";
import assert from "node:assert/strict";
import { CoalescingQueue, mergeSyncRequests } from "../src/sync/coalescing-queue.js";

test("save and blur requests serialize and collapse to the latest Markdown", async () => {
  const events = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const queue = new CoalescingQueue(async (_key, request) => {
    events.push(`start:${request.markdown}:${request.interactive}`);
    if (request.markdown === "saved") await firstGate;
    events.push(`end:${request.markdown}`);
  }, mergeSyncRequests);

  const running = queue.enqueue("note", { uri: "note", markdown: "saved", interactive: false });
  await Promise.resolve();
  assert.equal(
    queue.enqueue("note", { uri: "note", markdown: "blur-1", interactive: false }),
    running,
  );
  queue.enqueue("note", { uri: "note", markdown: "blur-2", interactive: true });
  releaseFirst();
  await running;

  assert.deepEqual(events, [
    "start:saved:false",
    "end:saved",
    "start:blur-2:true",
    "end:blur-2",
  ]);
});

test("different note keys may progress independently", async () => {
  const seen = [];
  const queue = new CoalescingQueue(async (key, value) => seen.push(`${key}:${value}`));
  await Promise.all([queue.enqueue("a", 1), queue.enqueue("b", 2)]);
  assert.deepEqual(seen.sort(), ["a:1", "b:2"]);
});
