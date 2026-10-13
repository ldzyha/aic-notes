import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EditorState } from "@codemirror/state";
import {
  focusPageTarget,
  focusedPage,
  notePageCards,
  pageExternalChange,
} from "../vendor/aic-editor-core/note-page-cards.js";
import {
  appendPageText,
  notePages,
} from "../vendor/aic-editor-core/note-pages.js";
import { hostChange, remote } from "../src/webview/host-changes.js";

function focused(text, target) {
  let state = EditorState.create({ doc: text, extensions: [notePageCards()] });
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
