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
  slashSnippetSearchText,
  slashSnippetTemplate,
} from "../vendor/aic-editor-core/slash-snippets.js";

function state(doc, readOnly = false) {
  return EditorState.create({
    doc,
    extensions: [markdownLanguage, EditorState.readOnly.of(readOnly)],
  });
}

test("shared slash catalog covers pages, sections, and formatting blocks", () => {
  assert.equal(SLASH_SNIPPETS_CORE_VERSION, "1.2.0");
  assert.equal(
    new Set(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).size,
    DOCUMENTATION_SNIPPETS.length,
  );
  assert.deepEqual(
    new Set(DOCUMENTATION_SNIPPETS.map(({ kind }) => kind)),
    new Set(["page", "section", "block"]),
  );
  assert.deepEqual(
    new Set(DOCUMENTATION_SNIPPETS.map(({ group }) => group)),
    new Set([
      "pages",
      "structure",
      "assurance",
      "references",
      "data",
      "diagrams",
      "content",
    ]),
  );
  for (const entry of DOCUMENTATION_SNIPPETS) {
    assert.match(entry.question, /\?$/u);
    if (entry.command === "security")
      assert.match(entry.template, /^```aic-security\n/u);
    else assert.match(entry.template, /\$\{/u);
  }
});

test("shared basic blocks distinguish unordered points, ordered points and a generic table", () => {
  const byCommand = Object.fromEntries(
    DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
  );
  assert.match(byCommand.list.template, /^- \$\{1:/u);
  assert.equal(byCommand.list.template.match(/^- /gmu).length, 3);
  assert.match(byCommand.list.question, /one idea per item/u);
  assert.equal(
    byCommand.checklist.template,
    "- [ ] ${1:What needs to be done?}${0}",
  );
  assert.deepEqual(byCommand.checklist.searchTerms, ["checkbox", "tasklist"]);
  assert.equal(
    slashSnippetSearchText(byCommand.checklist),
    "/checklist /checkbox /tasklist",
  );
  assert.match(byCommand["list-numbered"].template, /^1\. \$\{1:/u);
  assert.match(byCommand["list-numbered"].template, /\n2\. .*\n3\. /u);
  assert.match(
    byCommand.table.template,
    /^\| \$\{1:Item\} \| \$\{2:Detail\} \|\n\| --- \| --- \|/u,
  );
  for (const command of ["list", "list-numbered", "checklist", "table"]) {
    assert.equal(byCommand[command].kind, "block");
    assert.equal(byCommand[command].group, "data");
    assert.equal(
      slashSnippetTemplate(byCommand[command], "# Page\n\n## Answer\n"),
      byCommand[command].template,
    );
  }
  for (const command of ["mapping-table", "comparison", "tasks"]) {
    assert.ok(byCommand[command]);
  }
});

test("shared checkbox aliases keep one visible completion and never activate in code", () => {
  for (const command of ["checklist", "checkbox", "tasklist"]) {
    const doc = "/" + command;
    const result = slashSnippetCompletions(
      new CompletionContext(state(doc), doc.length, true),
    );
    const items = result.options.filter(
      ({ label, displayLabel }) => (displayLabel ?? label) === "/checklist",
    );
    assert.equal(items.length, 1);
    assert.ok(items[0].label.includes(doc));
    assert.equal(items[0].section.name, "Tables & lists");
    const fenced = "```markdown\n" + doc + "\n```";
    assert.equal(
      slashSnippetQuery(state(fenced), fenced.indexOf(doc) + doc.length),
      null,
    );
    assert.equal(slashSnippetQuery(state(doc, true), doc.length), null);
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
    result.options.find(({ label }) => label === "/section").section.rank,
    0,
  );
  assert.equal(
    result.options.find(({ label }) => label === "/section").section.name,
    "Structure",
  );
  assert.equal(
    result.options.find(({ label }) => label === "/glossary").section.name,
    "References",
  );
  assert.equal(
    result.options.find(({ label }) => label === "/flowchart").section.name,
    "Diagrams",
  );
  assert.ok(result.options.every(({ info }) => info === undefined));
  assert.equal(
    result.options.find(({ label }) => label === "/page").section.rank,
    6,
  );
});

test("Core catalog supports waves, noise and contextual document sections", () => {
  const byCommand = Object.fromEntries(
    DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
  );
  assert.equal(byCommand.purpose, undefined);
  assert.match(byCommand.noise.template, /same note/u);
  assert.match(
    byCommand.wave.template,
    /Prerequisite.*Action.*Verifiable result/u,
  );
  assert.match(byCommand.implementation.template, /### Error handling/u);
  assert.match(byCommand["entity-map"].template, /flowchart TB/u);
  assert.match(byCommand.timeline.template, /\ntimeline\n/u);
  assert.match(
    slashSnippetTemplate(byCommand.section, "# Document\n\n## Subject\n"),
    /^### /u,
  );
  for (const entry of DOCUMENTATION_SNIPPETS) {
    assert.doesNotMatch(
      entry.template,
      /Purpose:|single question|one primary representation/u,
    );
    assert.doesNotMatch(entry.template, /^---\n/u);
  }
});
