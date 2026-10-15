import test from "node:test";
import assert from "node:assert/strict";
import {
  activeResource,
  isProjectNote,
  projectNoteName,
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

test("the project note is <folder name>.note.md; a file's page target is its project-relative path", () => {
  const folder = { name: "app", uri: { path: "/work/app" } };
  const at = (path) => ({ path });
  assert.equal(projectNoteName(folder), "app.note.md");
  assert.equal(
    projectNoteName({ name: "My Ünï.v2", uri: { path: "/x/y" } }),
    "My Ünï.v2.note.md",
  );
  // A custom workspace name that is no file name: the folder's own name.
  for (const name of ["a/b", "a\\b", "", "..", undefined])
    assert.equal(
      projectNoteName({ name, uri: { path: "/srv/api-docs/" } }),
      "api-docs.note.md",
      String(name),
    );
  assert.equal(projectNoteName({ name: "", uri: { path: "/" } }), null);
  assert.equal(pageTargetFor(folder, at("/work/app/src/a.ts")), "src/a.ts");
  assert.equal(pageTargetFor(folder, at("/work/app/a.note.md")), "a.note.md");
  assert.equal(pageTargetFor(folder, at("/work/app/aic.md")), "aic.md");
  assert.equal(
    pageTargetFor(folder, at("/work/app/docs/app.note.md")),
    "docs/app.note.md",
  );
  assert.equal(
    pageTargetFor({ ...folder, uri: { path: "/work/app/" } }, at("/work/app/b.js")),
    "b.js",
  );
  for (const path of [
    "/work/app/app.note.md",
    "/work/app/APP.NOTE.md",
    "/work/app",
    "/work/application/a.ts",
    "/elsewhere/a.ts",
  ])
    assert.equal(pageTargetFor(folder, at(path)), null, path);
  assert.equal(isProjectNote(folder, at("/work/app/app.note.md")), true);
  assert.equal(isProjectNote(folder, at("/work/app/docs/app.note.md")), false);
  assert.equal(isProjectNote(folder, at("/work/app/aic.md")), false);
  assert.equal(isProjectNote(folder, at("/work/application/app.note.md")), false);
});
