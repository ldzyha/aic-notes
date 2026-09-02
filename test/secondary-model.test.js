import test from "node:test";
import assert from "node:assert/strict";
import {
  activeResource,
  isNotePath,
  markdownKind,
  linkedNotePath,
  NavigationQueue,
  paneCapabilities,
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

test("note actions depend on note existence, never pin state", () => {
  assert.deepEqual(
    paneCapabilities({
      hasDocument: true,
      hasPlaceholder: false,
      hasSource: true,
    }),
    {
      hasSurface: true,
      canPin: true,
      canOpenTarget: true,
      canTrash: true,
    },
  );
  assert.deepEqual(
    paneCapabilities({
      hasDocument: false,
      hasPlaceholder: true,
      hasSource: true,
    }),
    {
      hasSurface: true,
      canPin: true,
      canOpenTarget: true,
      canTrash: false,
    },
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

test("note paths are Secondary-only candidates without note-of-note recursion", () => {
  assert.equal(isNotePath("src/app.note.md"), true);
  assert.equal(isNotePath("src/app.md"), false);
  assert.equal(linkedNotePath("src/app.ts"), "src/app.note.md");
  assert.equal(linkedNotePath("src/README.md"), "src/README.note.md");
  assert.equal(linkedNotePath("src/app.note.md"), "src/app.note.md");
});

test("all Markdown paths have an explicit note or document identity", () => {
  assert.equal(markdownKind("src/app.note.md"), "note");
  assert.equal(markdownKind("docs/README.md"), "document");
  assert.equal(markdownKind("docs/README.MD"), "document");
  assert.equal(markdownKind("src/app.ts"), null);
});
