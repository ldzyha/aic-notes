import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { redo, undo } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import {
  focusPageTarget,
  focusedPage,
  notePageCards,
  notePageHistory,
  pageExternalChange,
} from "../vendor/aic-editor-core/note-page-cards.js";
import {
  appendPageText,
  notePages,
} from "../vendor/aic-editor-core/note-pages.js";
import { hostChange, remote } from "../src/webview/host-changes.js";

// The Secondary pane's page and history extensions (src/webview/main.js).
function focused(text, target) {
  let state = EditorState.create({
    doc: text,
    extensions: [notePageCards(), notePageHistory()],
  });
  const view = {
    get state() {
      return state;
    },
    dispatch(spec) {
      state = state.update(spec).state;
    },
  };
  assert.equal(focusPageTarget(view, target), true);
  return view;
}

const NOTE = "intro\n\n--- a.js\nabout a\n\n--- b.js\nabout b\n";
const NEXT = "# Title\n\nintro\n\n--- b.js\nB first\n\n--- a.js\nA moved\n";

test("host text replaces the whole document while a page is focused and the focus follows its target", () => {
  const view = focused(NOTE, "a.js");
  // Without the external mark the page cards drop a change outside the page.
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: NEXT },
    annotations: [remote.of(true)],
  });
  assert.equal(view.state.doc.toString(), NOTE);

  const spec = hostChange({ from: 0, to: view.state.doc.length, insert: NEXT });
  const transaction = view.state.update(spec);
  assert.equal(transaction.annotation(remote), true);
  assert.equal(transaction.annotation(pageExternalChange), true);
  assert.equal(transaction.annotation(Transaction.addToHistory), false);
  view.dispatch(spec);
  assert.equal(view.state.doc.toString(), NEXT);
  const page = focusedPage(view.state);
  assert.equal(page.target, "a.js");
  assert.equal(NEXT.slice(page.from, page.to), "A moved\n");

  // Partial external edits (VS Code content changes) outside the page too.
  view.dispatch(hostChange([{ from: 0, to: 0, insert: "x" }]));
  assert.equal(view.state.doc.toString(), `x${NEXT}`);
  assert.equal(focusedPage(view.state).target, "a.js");

  // The host removed the page: the card stays, empty, for the same target.
  view.dispatch(
    hostChange({ from: 0, to: view.state.doc.length, insert: "intro\n" }),
  );
  assert.deepEqual(
    [focusedPage(view.state).target, focusedPage(view.state).exists],
    ["a.js", false],
  );
});

test("every document replacement the webview applies from a host message is marked external", async () => {
  const main = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  const handler = main.slice(main.indexOf('window.addEventListener("message"'));
  // external, reset and committed; init rebuilds the editor instead.
  assert.equal(handler.match(/view\.dispatch\(\s*hostChange\(/gu).length, 3);
  for (const type of ["external", "reset", "committed"]) {
    const from = handler.indexOf(`case "${type}": {`);
    const body = handler.slice(from, handler.indexOf("break;", from));
    assert.match(body, /hostChange\(/u, type);
  }
  assert.doesNotMatch(handler, /changes:\s*msg\./u);
  assert.equal(handler.match(/remote\.of\(true\)/gu).length, 1);
  assert.match(
    handler,
    /selection: \{[^}]*\},\s*scrollIntoView: true,\s*annotations: \[remote\.of\(true\)\]/u,
  );
});

test("a bound separator starts a page even inside an unclosed fence", () => {
  const text =
    "--- a.js\n```js\ncode\n\n--- b.js\nabout b\n\n--- c.js\nabout c\n";
  const a = focusedPage(focused(text, "a.js").state);
  assert.equal(text.slice(a.from, a.to), "```js\ncode");
  const b = focusedPage(focused(text, "b.js").state);
  assert.deepEqual([b.exists, text.slice(b.from, b.to)], [true, "about b"]);
  // Nothing closes the fence for the writer and no page is duplicated.
  assert.equal(appendPageText(text, "d.js"), "\n--- d.js\n");
  assert.deepEqual(
    notePages(`${text}${appendPageText(text, "d.js")}`).map(
      ({ target }) => target,
    ),
    ["a.js", "b.js", "c.js", "d.js"],
  );
  // A leading separator keeps its empty page; an unreadable target is unbound.
  assert.deepEqual(
    notePages("--- a.js\n\n--- b.js\n\n--- c.js\nC").map(
      ({ target }) => target,
    ),
    ["a.js", "b.js", "c.js"],
  );
  assert.equal(appendPageText("", `a${String.fromCharCode(0x2028)}b`), "");
  assert.equal(
    focusPageTarget(focused(text, "a.js"), `a${String.fromCharCode(0x2028)}b`),
    false,
  );
});

function type(view, text) {
  const page = focusedPage(view.state);
  // The last page's range runs to the end of the note: type before its line end.
  const body = view.state.sliceDoc(page.from, page.to).replace(/\n$/u, "");
  view.dispatch({
    changes: { from: page.from + body.length, insert: text },
    userEvent: "input.type",
  });
}

test("undo stays inside the focused page and never reverts host text", () => {
  const view = focused(NOTE, "a.js");
  const text = () => view.state.doc.toString();
  type(view, " more");
  const edited = "intro\n\n--- a.js\nabout a more\n\n--- b.js\nabout b\n";
  assert.equal(text(), edited);

  // Undo and redo work while the same target stays focused.
  assert.equal(undo(view), true);
  assert.equal(text(), NOTE);
  assert.equal(redo(view), true);
  assert.equal(text(), edited);
  assert.equal(focusPageTarget(view, "a.js"), true);
  assert.equal(undo(view), true);
  assert.equal(redo(view), true);
  assert.equal(text(), edited);

  // Another target: page A can no longer be undone or redone from here.
  assert.equal(focusPageTarget(view, "b.js"), true);
  assert.equal(text(), edited);
  assert.equal(undo(view), false);
  assert.equal(redo(view), false);
  assert.equal(text(), edited);
  type(view, "!");
  const both = "intro\n\n--- a.js\nabout a more\n\n--- b.js\nabout b!\n";
  assert.equal(text(), both);
  assert.equal(undo(view), true);
  assert.equal(text(), edited);
  assert.equal(undo(view), false);
  assert.equal(text(), edited);

  // Back on A, and on the whole note: the old steps stay gone.
  for (const target of ["a.js", null]) {
    assert.equal(focusPageTarget(view, target), true);
    assert.equal(undo(view), false);
    assert.equal(text(), edited);
  }

  // Host text is not an undo step; the user's own step still is.
  focusPageTarget(view, "b.js");
  type(view, "?");
  view.dispatch(hostChange([{ from: 0, to: 0, insert: "# T\n\n" }]));
  const hosted = `# T\n\n${edited.replace("about b", "about b?")}`;
  assert.equal(text(), hosted);
  assert.equal(undo(view), true);
  assert.equal(text(), `# T\n\n${edited}`);
  assert.equal(undo(view), false);
  view.dispatch(
    hostChange({ from: 0, to: view.state.doc.length, insert: NEXT }),
  );
  assert.equal(undo(view), false);
  assert.equal(text(), NEXT);
});

test("the Secondary pane installs only the page history", async () => {
  const main = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  assert.match(main, /secondarySurface \? \[notePageHistory\(\)\] : \[\]/u);
  // CodeMirror's history field is a singleton: a plain history() next to the
  // page history would survive the reset on a target change.
  assert.doesNotMatch(main, /(?<![A-Za-z])history\(/u);
  assert.doesNotMatch(main, /import \{[^}]*\bhistory\b[^}]*\} from/u);
  const host = await readFile(
    new URL("../src/webview/host-changes.js", import.meta.url),
    "utf8",
  );
  assert.match(host, /\.\.\.pageExternalAnnotations\(\)/u);
});
