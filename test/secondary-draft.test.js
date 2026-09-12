import test from "node:test";
import assert from "node:assert/strict";
import {
  SecondaryDraft,
  secondarySaveState,
  minimalTextChange,
} from "../src/webview/secondary-draft.js";

function setup(text = "base", path = "project.note.md") {
  const draft = new SecondaryDraft();
  draft.hydrate(text, 3, { discardLocal: true, relativePath: path });
  return draft;
}

function state(draft, placeholder = false) {
  return secondarySaveState({
    dirty: draft.dirty,
    pending: draft.pending,
    placeholder,
  });
}

test("save state is neutral when saved, grey for placeholders, and dirty for edits or pending save", () => {
  const draft = setup();
  assert.equal(state(draft), "saved");
  assert.equal(state(draft, true), "placeholder");
  assert.equal(
    secondarySaveState({ hasSurface: false, dirty: true }),
    "unavailable",
  );
  draft.edit("edit");
  assert.equal(state(draft), "dirty");
  const commit = draft.begin();
  assert.equal(state(draft), "dirty");
  assert.equal(draft.begin(), null);
  draft.edit("base");
  assert.equal(draft.dirty, false);
  assert.equal(
    state(draft),
    "dirty",
    "in-flight save must never look saved after Undo",
  );
  draft.acknowledge({ ...commit, saved: true });
  assert.equal(draft.current, "base");
  assert.equal(
    state(draft),
    "dirty",
    "reverted input differs from the version now saved",
  );
});

test("matching success adopts host-stamped properties without leaving a false dirty state", () => {
  const draft = setup("---\nupdated: yesterday\n---\n\nBody");
  draft.edit(`${draft.current} edit`);
  const commit = draft.begin();
  const text = commit.text.replace("yesterday", "today");
  assert.equal(draft.acknowledge({ ...commit, text, saved: true }), true);
  assert.equal(draft.current, text);
  assert.equal(state(draft), "saved");
  assert.deepEqual(minimalTextChange(commit.text, text), {
    from: 13,
    to: 19,
    insert: "to",
  });
  assert.equal(minimalTextChange(text, text), null);
});

test("new input during save stays dirty and is not replaced by older stamped text", () => {
  const draft = setup();
  draft.edit("submitted");
  const commit = draft.begin();
  draft.edit("submitted plus newer input");
  draft.acknowledge({ ...commit, text: "stamped submitted", saved: true });
  assert.equal(draft.current, "submitted plus newer input");
  assert.equal(state(draft), "dirty");
  const retry = draft.begin();
  draft.acknowledge({ ...retry, saved: true });
  assert.equal(state(draft), "saved");
});

test("failure keeps the draft, allows retry, and ignores older or wrong-note replies", () => {
  const draft = setup();
  draft.edit("edit");
  const first = draft.begin();
  assert.equal(
    draft.acknowledge({ ...first, relativePath: "other.note.md", saved: true }),
    false,
  );
  assert.equal(draft.pending, true);
  assert.equal(draft.acknowledge({ ...first, saved: false }), true);
  assert.equal(state(draft), "dirty");
  assert.equal(draft.current, "edit");
  const second = draft.begin();
  assert.equal(draft.acknowledge({ ...first, saved: true }), false);
  assert.equal(draft.pending, true);
  draft.acknowledge({ ...second, saved: true });
  assert.equal(state(draft), "saved");
});

test("switching notes clears pending identity and rejects late acknowledgements", () => {
  const draft = setup();
  draft.edit("same text");
  const old = draft.begin();
  draft.hydrate("same text", 4, {
    discardLocal: true,
    relativePath: "other.note.md",
  });
  assert.equal(state(draft), "saved");
  assert.equal(draft.pending, false);
  draft.edit("other edited");
  const current = draft.begin();
  assert.equal(
    draft.acknowledge({ ...old, text: "old stamped", saved: true }),
    false,
  );
  assert.equal(draft.current, "other edited");
  assert.equal(draft.pending, true);
  draft.acknowledge({ ...current, saved: true });
  assert.equal(state(draft), "saved");
});

test("secondary drains a requested newer save once but never saves each intervening input", () => {
  const draft = setup();
  draft.edit("first");
  const first = draft.request();
  draft.edit("second");
  assert.equal(draft.request(), null);
  draft.acknowledge({ ...first, saved: true });
  assert.equal(draft.takeQueued(), true);
  const second = draft.request();
  draft.edit("third raw input");
  draft.acknowledge({ ...second, saved: true });
  assert.equal(draft.takeQueued(), false);
  assert.equal(draft.dirty, true);
  const retry = draft.request();
  draft.edit("fourth");
  draft.request();
  draft.acknowledge({ ...retry, saved: false });
  assert.equal(draft.takeQueued(), false);
  assert.equal(draft.dirty, true);
});
