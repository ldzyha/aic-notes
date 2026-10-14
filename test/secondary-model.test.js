import test from "node:test";
import assert from "node:assert/strict";
import {
  activeResource,
  isWorkspaceNote,
  NavigationQueue,
  pageTargetFor,
  preferredWorkspaceFolder,
} from "../src/secondary/model.js";

test("active custom-editor tab wins over a stale native text editor", () => {
  const tab = { path: "/project/current.md" };
  const staleEditor = { path: "/project/previous.md" };
  assert.equal(activeResource(tab, staleEditor), tab);
  assert.equal(activeResource(undefined, staleEditor), staleEditor);
  assert.equal(activeResource(undefined, staleEditor, true), undefined);
});

test("no active buffer falls back to the last project, then the first workspace", () => {
  const first = { name: "first" };
  const recent = { name: "recent" };
  const recentUri = { folder: recent };
  assert.equal(
    preferredWorkspaceFolder(
      [undefined, recentUri],
      [first, recent],
      (uri) => uri.folder,
    ),
    recent,
  );
  assert.equal(
    preferredWorkspaceFolder([], [first, recent], () => undefined),
    first,
  );
  assert.equal(
    preferredWorkspaceFolder([], undefined, () => undefined),
    undefined,
  );
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

test("a file's page target is its folder-relative path; the note is never its own page", () => {
  const folder = { path: "/work/app" };
  const at = (path) => ({ path });
  assert.equal(pageTargetFor(folder, at("/work/app/src/a.ts")), "src/a.ts");
  assert.equal(pageTargetFor(folder, at("/work/app/a.note.md")), "a.note.md");
  assert.equal(
    pageTargetFor(folder, at("/work/app/docs/aic.md")),
    "docs/aic.md",
  );
  assert.equal(
    pageTargetFor({ path: "/work/app/" }, at("/work/app/b.js")),
    "b.js",
  );
  for (const path of [
    "/work/app/aic.md",
    "/work/app/AIC.md",
    "/work/app",
    "/work/application/a.ts",
    "/elsewhere/a.ts",
  ])
    assert.equal(pageTargetFor(folder, at(path)), null, path);
  assert.equal(isWorkspaceNote(folder, at("/work/app/aic.md")), true);
  assert.equal(isWorkspaceNote(folder, at("/work/app/docs/aic.md")), false);
  assert.equal(isWorkspaceNote(folder, at("/work/app/a.note.md")), false);
  assert.equal(isWorkspaceNote(folder, at("/work/application/aic.md")), false);
});
