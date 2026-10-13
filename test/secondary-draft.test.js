import test from "node:test";
import assert from "node:assert/strict";
import {
  SecondaryDraft,
  secondarySaveState,
  minimalTextChange,
  mergeDraftText,
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

test("new input during save stays dirty and is carried onto the text the host saved", () => {
  const draft = setup();
  draft.edit("submitted");
  const commit = draft.begin();
  draft.edit("submitted plus newer input");
  draft.acknowledge({ ...commit, text: "stamped submitted", saved: true });
  assert.equal(draft.current, "stamped submitted plus newer input");
  assert.equal(state(draft), "dirty");
  assert.equal(draft.stale, false);
  const retry = draft.begin();
  assert.equal(retry.base, undefined);
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

test("a three-way draft merge keeps both changes byte-exact or refuses", () => {
  const base = "--- a.js\nabout a\n\n--- b.js\nabout b\n";
  const mine = base.replace("about a", "about a\r\n  more\t");
  const theirs = `# T\n\n${base.replace("about b", "B")}tail`;
  // Their minimal change spans my page (it changed before and after it).
  assert.equal(mergeDraftText(base, theirs, mine), null);
  const after = base.replace("about b", "B \u00e9");
  assert.equal(
    mergeDraftText(base, after, mine),
    "--- a.js\nabout a\r\n  more\t\n\n--- b.js\nB \u00e9\n",
  );
  const before = `# T\n\n${base}`;
  assert.equal(
    mergeDraftText(base, before, base.replace("about b", "mine")),
    "# T\n\n--- a.js\nabout a\n\n--- b.js\nmine\n",
  );
  assert.equal(mergeDraftText(base, base, mine), mine);
  assert.equal(mergeDraftText(base, theirs, base), theirs);
  assert.equal(mergeDraftText(base, mine, mine), mine);
  // The same page, and changes that only touch, are never merged.
  assert.equal(
    mergeDraftText(base, base.replace("about a", "theirs"), mine),
    null,
  );
  assert.equal(mergeDraftText("ab", "aXb", "aYb"), null);
  assert.equal(mergeDraftText("ab", "abX", "abY"), null);
  assert.equal(mergeDraftText("a b", "aX b", "a bY"), "aX bY");
});

test("a draft whose host text moved on sends its base until a save lands", () => {
  const draft = setup("one\n\ntwo\n");
  draft.edit("one mine\n\ntwo\n");
  assert.equal(draft.begin().base, undefined);
  draft.acknowledge({ requestId: 1, relativePath: "project.note.md" });
  draft.hostChanged();
  assert.equal(draft.stale, true);
  draft.edit("one mine!\n\ntwo\n");
  const stale = draft.begin();
  assert.equal(stale.base, "one\n\ntwo\n");
  // Refused by the host: the draft and its base stay for the next attempt.
  draft.acknowledge({ ...stale, saved: false });
  assert.deepEqual(
    [draft.current, draft.stale, state(draft)],
    ["one mine!\n\ntwo\n", true, "dirty"],
  );
  const retry = draft.begin();
  assert.equal(retry.base, "one\n\ntwo\n");
  // Rebased by the host: its text is adopted and the draft is in sync again.
  draft.acknowledge({
    ...retry,
    text: "one mine!\n\ntwo theirs\n",
    generation: 9,
    saved: true,
  });
  assert.deepEqual(
    [draft.current, draft.stale, state(draft)],
    ["one mine!\n\ntwo theirs\n", false, "saved"],
  );

  // Input typed during that save which overlaps the host's part stays a
  // stale draft on the committed text: it can never replace the host's text.
  draft.edit("one mine!\n\ntwo theirs\nmore");
  const commit = draft.begin();
  draft.edit("one mine!\n\ntwo theirs\nmore and newer");
  draft.acknowledge({
    ...commit,
    text: "one mine!\n\ntwo theirs\nmore\n\n--- x\nappended",
    saved: true,
  });
  assert.equal(draft.current, "one mine!\n\ntwo theirs\nmore and newer");
  assert.deepEqual([draft.stale, state(draft)], [true, "dirty"]);
  assert.equal(draft.begin().base, "one mine!\n\ntwo theirs\nmore");
  // A fresh host text ends the stale state.
  draft.hydrate("fresh", 10, { discardLocal: true });
  assert.equal(draft.stale, false);
});
