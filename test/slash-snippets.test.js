import test from "node:test";
import assert from "node:assert/strict";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { markdownLanguage } from "../vendor/markdown/language.js";
import {
  DOCUMENTATION_SNIPPETS,
  SLASH_SNIPPETS_CORE_VERSION,
  slashSnippetCompletions,
  slashSnippetQuery,
} from "../vendor/aic-editor-core/slash-snippets.js";

function state(doc, readOnly = false) {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage, EditorState.readOnly.of(readOnly)],
  });
}

test("shared slash catalog covers pages, sections, and formatting blocks", () => {
  assert.equal(SLASH_SNIPPETS_CORE_VERSION, "1.0.0");
  assert.equal(
    new Set(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).size,
    DOCUMENTATION_SNIPPETS.length,
  );
  assert.deepEqual(
    new Set(DOCUMENTATION_SNIPPETS.map(({ kind }) => kind)),
    new Set(["page", "section", "block"]),
  );
  for (const entry of DOCUMENTATION_SNIPPETS) {
    assert.match(entry.question, /\?$/u);
    assert.match(entry.template, /\$\{/u);
  }
});

test("slash activation is line-scoped, writable, and outside code fences", () => {
  assert.deepEqual(slashSnippetQuery(state("/"), 1), {
    from: 0,
    to: 1,
    text: "/",
    hasPageContent: false,
  });
  assert.equal(slashSnippetQuery(state("Text /page"), 10), null);
  const fenced = "~~~text\n/page\n~~~";
  assert.equal(
    slashSnippetQuery(state(fenced), fenced.indexOf("/page") + 5),
    null,
  );
  assert.equal(slashSnippetQuery(state("/page", true), 5), null);
});

test("slash completion ranks sections first inside an existing page", () => {
  const editorState = state("# Existing\n\n/");
  const result = slashSnippetCompletions(
    new CompletionContext(editorState, editorState.doc.length, false),
  );
  assert.ok(result);
  assert.equal(result.from, editorState.doc.length - 1);
  assert.equal(
    result.options.find(({ label }) => label === "/purpose").section.rank,
    0,
  );
  assert.equal(
    result.options.find(({ label }) => label === "/page").section.rank,
    2,
  );
});
