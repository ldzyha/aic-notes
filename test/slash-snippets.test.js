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

test("shared slash catalog covers blocks, DDK sections and diagrams", () => {
  assert.equal(SLASH_SNIPPETS_CORE_VERSION, "2.0.0");
  assert.equal(DOCUMENTATION_SNIPPETS.length, 18);
  assert.equal(
    new Set(DOCUMENTATION_SNIPPETS.map(({ command }) => command)).size,
    DOCUMENTATION_SNIPPETS.length,
  );
  assert.deepEqual(
    new Set(DOCUMENTATION_SNIPPETS.map(({ kind }) => kind)),
    new Set(["section", "block"]),
  );
  const commandsIn = (group) =>
    DOCUMENTATION_SNIPPETS.filter((entry) => entry.group === group).map(
      ({ command }) => command,
    );
  assert.deepEqual(commandsIn("blocks"), [
    "aic",
    "list",
    "list-numbered",
    "checklist",
    "table",
    "code",
    "details",
  ]);
  assert.deepEqual(commandsIn("sections"), [
    "section",
    "glossary",
    "bibliography",
    "high-level-design",
    "detailed-view",
    "error-handling",
    "test-cases",
    "open-question",
  ]);
  assert.deepEqual(commandsIn("diagrams"), [
    "flowchart",
    "sequence",
    "state-diagram",
  ]);
  for (const entry of DOCUMENTATION_SNIPPETS) {
    assert.match(entry.question, /\?$/u);
    assert.equal(entry.kind === "section", entry.group === "sections");
    if (entry.command === "aic") assert.match(entry.template, /^```aic\n/u);
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
    assert.equal(byCommand[command].group, "blocks");
    assert.equal(
      slashSnippetTemplate(byCommand[command], "# Page\n\n## Answer\n"),
      byCommand[command].template,
    );
  }
  for (const command of ["mapping-table", "comparison", "tasks"]) {
    assert.equal(byCommand[command], undefined);
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
    // Core ranks the matches itself: the command or its alias comes first.
    assert.equal(result.filter, false);
    assert.equal(result.options[0], items[0]);
    assert.equal(items[0].label, "/checklist");
    assert.equal(items[0].section.name, "Blocks");
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
  assert.equal(slashSnippetQuery(state("Text /section"), 13), null);
  const fenced = "~~~text\n/section\n~~~";
  assert.equal(
    slashSnippetQuery(state(fenced), fenced.indexOf("/section") + 8),
    null,
  );
  assert.equal(slashSnippetQuery(state("/section", true), 8), null);
});

test("slash completion keeps one fixed group order in empty and existing documents", () => {
  const optionsFor = (doc) => {
    const editorState = state(doc);
    const result = slashSnippetCompletions(
      new CompletionContext(editorState, editorState.doc.length, false),
    );
    assert.ok(result);
    assert.equal(result.from, editorState.doc.length - 1);
    assert.equal(result.options.length, DOCUMENTATION_SNIPPETS.length);
    assert.ok(result.options.every(({ info }) => info === undefined));
    return result.options;
  };
  for (const doc of ["/", "# Existing\n\n/"]) {
    const options = optionsFor(doc);
    const shown = (command) =>
      options.find(
        ({ label, displayLabel }) => (displayLabel ?? label) === command,
      );
    assert.deepEqual(shown("/aic").section, { name: "Blocks", rank: 0 });
    assert.deepEqual(shown("/table").section, { name: "Blocks", rank: 0 });
    assert.deepEqual(shown("/section").section, { name: "Sections", rank: 1 });
    assert.deepEqual(shown("/glossary").section, { name: "Sections", rank: 1 });
    assert.deepEqual(shown("/flowchart").section, {
      name: "Diagrams",
      rank: 2,
    });
    assert.deepEqual(shown("/state-diagram").section, {
      name: "Diagrams",
      rank: 2,
    });
    assert.equal(shown("/page"), undefined);
    assert.equal(shown("/security"), undefined);
  }
});

test("Core catalog renames /security to /aic and keeps old words as aliases", () => {
  const byCommand = Object.fromEntries(
    DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
  );
  assert.equal(byCommand.security, undefined);
  assert.equal(byCommand.aic.title, "AIC block (fields, secrets, codes)");
  for (const alias of [
    "security",
    "password",
    "2fa",
    "fields",
    "properties",
    "credentials",
  ]) {
    assert.ok(byCommand.aic.searchTerms.includes(alias), alias);
    const doc = "/" + alias;
    const result = slashSnippetCompletions(
      new CompletionContext(state(doc), doc.length, true),
    );
    assert.equal(result.options[0].displayLabel, "/aic", alias);
    assert.equal(
      result.options.filter(({ label }) => label === "/aic").length,
      1,
    );
  }
  // A command match is first even when another group is listed earlier.
  for (const [typed, command] of [
    ["/error", "/error-handling"],
    ["/aic", "/aic"],
    ["/sec", "/section"],
    ["/test", "/test-cases"],
    ["/gloss", "/glossary"],
    ["/list", "/list"],
  ]) {
    const result = slashSnippetCompletions(
      new CompletionContext(state(typed), typed.length, true),
    );
    assert.equal(result.options[0].label, command, typed);
  }
  assert.deepEqual(byCommand["high-level-design"].searchTerms, ["high-level"]);
  assert.deepEqual(byCommand["error-handling"].searchTerms, ["errors"]);
  assert.deepEqual(byCommand["test-cases"].searchTerms, ["verification"]);
  assert.deepEqual(byCommand["open-question"].searchTerms, ["open-questions"]);
  assert.deepEqual(byCommand.flowchart.searchTerms, ["mermaid"]);
});

test("Core catalog re-levels DDK sections and drops the retired page commands", () => {
  const byCommand = Object.fromEntries(
    DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
  );
  for (const command of [
    "purpose",
    "page",
    "page-architecture",
    "page-capability",
    "page-decision",
    "context",
    "noise",
    "wave",
    "implementation",
    "owned-detail",
    "synthesis",
    "entity-map",
    "class-diagram",
    "timeline",
  ]) {
    assert.equal(byCommand[command], undefined, command);
  }
  assert.match(byCommand.section.template, /^## \$\{1:Title\}\n\n\*\$\{2:/u);
  assert.match(
    byCommand["high-level-design"].template,
    /```mermaid\nflowchart LR\n[\s\S]*\| Part \| Responsibility \| Dependency \|/u,
  );
  assert.match(
    byCommand["detailed-view"].template,
    /\| Step \| Owner \| Behavior \| Completion condition \|/u,
  );
  assert.match(
    byCommand["error-handling"].template,
    /\| Failure \| Response \| Recovery \/ cleanup \|/u,
  );
  assert.match(
    byCommand["test-cases"].template,
    /\| Scenario \/ precondition \| Action \| Expected result \|/u,
  );
  assert.match(byCommand.sequence.template, /\nsequenceDiagram\n/u);
  assert.match(byCommand["state-diagram"].template, /\nstateDiagram-v2\n/u);
  assert.match(slashSnippetTemplate(byCommand.section, ""), /^# /u);
  assert.match(
    slashSnippetTemplate(byCommand.section, "# Document\n\n## Subject\n"),
    /^### /u,
  );
  assert.match(
    slashSnippetTemplate(
      byCommand["high-level-design"],
      "# Document\n\n## Subject\n",
    ),
    /^### High-level design\n/u,
  );
  assert.match(
    slashSnippetTemplate(byCommand.glossary, "###### Deepest\n"),
    /^###### Glossary\n/u,
  );
  assert.match(
    slashSnippetTemplate(
      byCommand["open-question"],
      "# Doc\n\n```md\n### Not a heading\n```\n",
    ),
    /^## Open question\n/u,
  );
  for (const command of ["flowchart", "sequence", "state-diagram", "aic"]) {
    assert.equal(
      slashSnippetTemplate(byCommand[command], "# Document\n\n## Subject\n"),
      byCommand[command].template,
    );
  }
  for (const entry of DOCUMENTATION_SNIPPETS) {
    assert.doesNotMatch(
      entry.template,
      /Purpose:|single question|one primary representation/u,
    );
    assert.doesNotMatch(entry.template, /^---\n/u);
  }
});
