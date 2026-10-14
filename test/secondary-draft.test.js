import test from "node:test";
import assert from "node:assert/strict";
import {
  SecondaryDraft,
  secondarySaveState,
  minimalTextChange,
  mergeDraftText,
} from "../src/webview/secondary-draft.js";
import { mergeDraftPages } from "../src/secondary/model.js";

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

test("input typed during a save is rebased as one textual hunk or refused", () => {
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

  // Input typed during that save is carried into its page of the host's
  // text, also when the host's part touches it or lies on both sides of it.
  draft.hydrate("intro\n\n--- p\nmo", 9, { discardLocal: true });
  draft.edit("intro\n\n--- p\nmore");
  const appended = draft.begin();
  draft.edit("intro\n\n--- p\nmore and newer");
  draft.acknowledge({
    ...appended,
    text: "INTRO\n\n--- p\nmore\n\n--- x\nappended",
    saved: true,
  });
  assert.equal(
    draft.current,
    "INTRO\n\n--- p\nmore and newer\n\n--- x\nappended",
  );
  assert.deepEqual([draft.stale, state(draft)], [false, "dirty"]);
  draft.hydrate("one mine!\n\ntwo theirs\n", 9, { discardLocal: true });

  // Input that changes the same page as the host's part stays a stale draft
  // on the committed text: it can never replace the host's text.
  draft.edit("one mine!\n\ntwo theirs\nmore");
  const commit = draft.begin();
  draft.edit("one mine!\n\ntwo theirs\nmore and newer");
  draft.acknowledge({
    ...commit,
    text: "one mine!\n\ntwo theirs\nmore HOST",
    saved: true,
  });
  assert.equal(draft.current, "one mine!\n\ntwo theirs\nmore and newer");
  assert.deepEqual([draft.stale, state(draft)], [true, "dirty"]);
  assert.equal(draft.begin().base, "one mine!\n\ntwo theirs\nmore");
  // A fresh host text ends the stale state.
  draft.hydrate("fresh", 10, { discardLocal: true });
  assert.equal(draft.stale, false);
});

const merged = (base, theirs, draft) => mergeDraftPages(base, theirs, draft);

test("a page merge takes the draft's pages and keeps every other byte of the file", () => {
  const base =
    "intro \t\n\n--- src/a.js\nabout a\n\n--- b.js\nabout b  \n\n--- c.js\nabout c";
  const draft = base.replace("about a", "about a MINE");
  // The file changed before and after the dirty page.
  const theirs = base
    .replace("intro", "INTRO")
    .replace("about c", "C theirs\n\n\n");
  assert.deepEqual(merged(base, theirs, draft), {
    text: theirs.replace("about a", "about a MINE"),
  });
  // Only before, only after, a removed and an added page, CRLF, odd blanks.
  for (const other of [
    base.replace("intro", "# T\r\n\r\nintro"),
    base.replace("about b  ", "B \u00e9\t\n\n\n"),
    base.replace("--- b.js\nabout b  \n\n", ""),
    `${base}\n\n--- d.js\nabout d\n`,
    base.replace("--- b.js", "--- B.js  ").replaceAll("\n", "\r\n"),
  ]) {
    const mine = other.includes("\r\n--- ")
      ? "about a MINE"
      : "about a\n\n  MINE\t";
    const local = base.replace("about a", mine);
    const result = merged(base, other, local);
    assert.equal(result.text, other.replace("about a", mine));
    // Nothing but the dirty page differs from the file.
    assert.equal(result.text.replace(mine, "about a"), other);
  }
  // Without an external change the draft is saved exactly as typed.
  const loose = `${draft}\n\n\n`;
  assert.deepEqual(merged(base, base, loose), { text: loose });
  assert.deepEqual(merged(base, theirs, base), { text: theirs });
  assert.deepEqual(merged(base, draft, draft), { text: draft });
  // Blank lines typed at the end of a page belong to the file when merging.
  assert.deepEqual(
    merged(base, theirs, base.replace("about a", "about a\n\n")),
    { text: theirs },
  );
});

test("a page changed on both sides is a conflict even without textual overlap", () => {
  const base = "--- a.js\none two three\n\n--- b.js\nabout b\n";
  const draft = base.replace("three", "three MINE");
  const page = { conflict: "page" };
  assert.deepEqual(merged(base, base.replace("one", "ONE"), draft), page);
  assert.deepEqual(
    merged(base, base.replace("one two three", ""), draft),
    page,
  );
  // The page is gone from, or renamed in, the file.
  assert.deepEqual(merged(base, "--- b.js\nabout b\n", draft), page);
  assert.deepEqual(merged(base, base.replace("a.js", "z.js"), draft), page);
  // `./a.js` is another target than `a.js`.
  assert.deepEqual(merged(base, base.replace("a.js", "./a.js"), draft), page);
  // The same new text on both sides is no conflict.
  const both = base.replace("three", "three MINE").replace("about b", "B");
  assert.deepEqual(merged(base, both, draft), { text: both });
  // Only the separator line changed in the file: its bytes are kept.
  const spelled = base.replace("--- a.js", "---   A.JS \t");
  assert.deepEqual(merged(base, spelled, draft), {
    text: spelled.replace("three", "three MINE"),
  });
});

test("a page the draft added is appended unless the file has it now", () => {
  const base = "intro\n\n--- a.js\nabout a";
  const draft = `${base}\n\n--- new/x.js\nmine\n\tx  \n`;
  const theirs = base.replace("intro", "INTRO\t") + "\n";
  const result = merged(base, theirs, draft);
  assert.equal(result.text, `${theirs}\n--- new/x.js\nmine\n\tx  \n`);
  assert.equal(result.text.startsWith(theirs), true);
  // An added page together with a changed one.
  assert.deepEqual(merged(base, theirs, draft.replace("about a", "A mine")), {
    text: `${theirs.replace("about a", "A mine")}\n--- new/x.js\nmine\n\tx  \n`,
  });
  // The file added another page meanwhile: both stay.
  const more = `${base}\n\n--- other.js\ntheirs`;
  assert.deepEqual(merged(base, more, draft), {
    text: `${more}\n\n--- new/x.js\nmine\n\tx  \n`,
  });
  // The file has that page now, however its target is spelled.
  for (const name of ["new/x.js", "NEW\\X.js", "new/x.js/"])
    assert.deepEqual(merged(base, `${base}\n\n--- ${name}\ntheirs`, draft), {
      conflict: "page",
    });
  // Typing into an empty page keeps the blank line before the next page.
  const empty = "--- a.js\n\n--- b.js\nabout b";
  assert.deepEqual(
    merged(
      empty,
      empty.replace("about b", "B"),
      empty.replace("a.js\n", "a.js\nmine\n"),
    ),
    { text: "--- a.js\nmine\n\n--- b.js\nB" },
  );
  const last = "intro\n\n--- a.js";
  assert.deepEqual(merged(last, `# ${last}`, `${last}\nmine`), {
    text: "# intro\n\n--- a.js\nmine",
  });
});

test("duplicate targets and structural draft changes are never merged with a changed file", () => {
  const base = "intro\n\n--- a.js\nabout a\n\n--- b.js\nabout b\n";
  const draft = base.replace("about a", "mine");
  const theirs = base.replace("about b", "B");
  const structure = { conflict: "structure" };
  // A target used twice in the base, the file or the draft.
  const twice = `${base}\n--- A.js\nagain\n`;
  assert.deepEqual(merged(twice, `${twice}x`, twice.replace("mine", "m")), {
    text: `${twice}x`,
  });
  assert.deepEqual(
    merged(twice, `${twice}x`, twice.replace("about b", "m")),
    structure,
  );
  assert.deepEqual(
    merged(base, `${theirs}\n--- A.js\nagain`, draft),
    structure,
  );
  assert.deepEqual(
    merged(base, theirs, `${draft}\n--- a.js\nagain`),
    structure,
  );
  // The draft removed, renamed, respelled, reordered or inserted a page.
  for (const structural of [
    base.replace("--- b.js\nabout b\n", ""),
    base.replace("--- a.js", "--- z.js"),
    base.replace("--- a.js", "--- A.js"),
    base.replace("--- a.js", "--- ./a.js"),
    "intro\n\n--- b.js\nabout b\n\n--- a.js\nabout a\n",
    base.replace("--- b.js", "--- n.js\nnew\n\n--- b.js"),
    base.replace("--- b.js", "---\nloose\n\n--- b.js"),
  ]) {
    assert.deepEqual(merged(base, theirs, structural), structure);
    // Allowed, saved as typed, while the file is what the draft started from.
    assert.deepEqual(merged(base, base, structural), { text: structural });
  }
});

test("unbound pages merge by position and refuse when they cannot be aligned", () => {
  const base =
    "intro\n\n--- a.js\nabout a\n\n---\nloose one\n\n---\nloose two\n";
  const theirs = base.replace("about a", "A theirs").replace("two", "2");
  // The leading text and the first bare page are the draft's; the rest stays.
  assert.deepEqual(
    merged(base, theirs, base.replace("intro", "INTRO").replace("one", "1")),
    { text: theirs.replace("intro", "INTRO").replace("one", "1") },
  );
  assert.deepEqual(merged(base, theirs, base.replace("two", "II")), {
    conflict: "page",
  });
  // A note that starts with its first page gains leading text in the file.
  const bound = "--- a.js\nabout a\n";
  assert.deepEqual(
    merged(bound, `intro\n\n${bound}`, bound.replace("about a", "mine")),
    { text: "intro\n\n--- a.js\nmine\n" },
  );
  assert.deepEqual(
    merged(bound, bound.replace("about a", "A"), `mine\n\n${bound}`),
    { text: "mine\n\n--- a.js\nA\n" },
  );
  // A bare page appeared in, or vanished from, the file.
  for (const other of [
    `${base}\n---\nthird\n`,
    base.replace("\n---\nloose two\n", ""),
  ])
    assert.deepEqual(merged(base, other, base.replace("about a", "mine")), {
      conflict: "structure",
    });
});
