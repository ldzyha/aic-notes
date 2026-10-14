import test from "node:test";
import assert from "node:assert/strict";
import { activeResource, NavigationQueue } from "../src/secondary/model.js";

test("active custom-editor tab wins over a stale native text editor", () => {
  const tab = { path: "/project/current.md" };
  const staleEditor = { path: "/project/previous.md" };
  assert.equal(activeResource(tab, staleEditor), tab);
  assert.equal(activeResource(undefined, staleEditor), staleEditor);
  assert.equal(activeResource(undefined, staleEditor, true), undefined);
});

test("navigation requests stay ordered and recover after rejection", async () => {
  const queue = new NavigationQueue();
  const events = [];
  let release;
  const first = queue.enqueue(
    () =>
      new Promise((resolve) => {
        release = () => {
          events.push("first");
          resolve("first");
        };
      }),
  );
  const failed = queue.enqueue(() => {
    events.push("failed");
    throw new Error("expected");
  });
  const last = queue.enqueue(() => {
    events.push("last");
    return "last";
  });
  await Promise.resolve();
  assert.deepEqual(events, []);
  release();
  assert.equal(await first, "first");
  await assert.rejects(failed, /expected/u);
  assert.equal(await last, "last");
  assert.deepEqual(events, ["first", "failed", "last"]);
});
