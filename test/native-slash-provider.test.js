import test from "node:test";
import assert from "node:assert/strict";
import { DOCUMENTATION_SNIPPETS } from "../vendor/aic-editor-core/slash-snippets.js";
import {
  createMarkdownSlashCompletionProvider,
  isInsideMarkdownFence,
  nativeMarkdownSlashQuery,
  registerMarkdownSlashCompletionProvider,
} from "../src/editor/slash-provider.js";

function markdownDocument(source, path = "/docs/readme.md") {
  const lines = source.split("\n");
  return {
    uri: { path },
    getText: () => source,
    lineAt: (line) => ({ text: lines[line] }),
    offsetAt: ({ line, character }) =>
      lines.slice(0, line).reduce((size, value) => size + value.length + 1, 0) +
      character,
  };
}

class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class CompletionItem {
  constructor(label, kind) {
    this.label = label;
    this.kind = kind;
  }
}

class CompletionList {
  constructor(items, isIncomplete) {
    this.items = items;
    this.isIncomplete = isIncomplete;
  }
}

class SnippetString {
  constructor(value) {
    this.value = value;
  }
}

const fakeVscode = {
  Position,
  Range,
  CompletionItem,
  CompletionList,
  CompletionItemKind: { Snippet: 15 },
  SnippetString,
};

test("native Markdown uses the shared slash catalog and group order", () => {
  const document = markdownDocument("# Existing\n\n/hig");
  const position = new Position(2, 4);
  const query = nativeMarkdownSlashQuery(document, position);
  assert.deepEqual(query, {
    text: "/hig",
    startCharacter: 0,
    hasPageContent: true,
  });

  const list = createMarkdownSlashCompletionProvider(
    fakeVscode,
  ).provideCompletionItems(document, position);
  // Asked again on every keystroke: the order follows what is typed.
  assert.equal(list.isIncomplete, true);
  const items = list.items;
  assert.deepEqual(
    items.map(({ label, sortText }) => [label, sortText]),
    [
      ["/high-level-design", "00"],
      // a loose match (h-i-g inside the command) comes after the prefix
      ["/error-handling", "01"],
    ],
  );
  const [design] = items;
  assert.equal(design.detail, "Sections · High-level design");
  assert.equal(design.filterText, "/hig");
  assert.equal(design.insertText.value.includes("${1:"), true);
  assert.deepEqual(design.range, new Range(new Position(2, 0), position));

  // A bare slash lists the whole catalogue in its own order, group by group.
  const empty = createMarkdownSlashCompletionProvider(
    fakeVscode,
  ).provideCompletionItems(markdownDocument("/"), new Position(0, 1)).items;
  assert.equal(empty.length, 18);
  assert.deepEqual(
    empty.map(({ label }) => label),
    DOCUMENTATION_SNIPPETS.map(({ command }) => "/" + command),
  );
  assert.deepEqual(
    empty.map(({ sortText }) => sortText),
    [...empty.map(({ sortText }) => sortText)].sort(),
  );
  assert.deepEqual(
    [...new Set(empty.map(({ detail }) => detail.split(" · ")[0]))],
    ["Blocks", "Sections", "Diagrams"],
  );
  assert.equal(
    empty.every(({ filterText }) => filterText === "/"),
    true,
  );
});

test("native Markdown lists the command match first for a typed word", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  // What VS Code shows: items whose filterText matches, by sortText.
  const shown = (source) => {
    const { items } = provider.provideCompletionItems(
      markdownDocument(source),
      new Position(0, source.length),
    );
    assert.equal(
      items.every(({ filterText }) => filterText === source),
      true,
    );
    return [...items]
      .sort((left, right) => (left.sortText < right.sortText ? -1 : 1))
      .map(({ label }) => label);
  };
  for (const [source, first] of [
    ["/error", "/error-handling"],
    ["/aic", "/aic"],
    ["/sec", "/section"],
    ["/test", "/test-cases"],
    ["/gloss", "/glossary"],
    ["/list", "/list"],
    ["/security", "/aic"],
    ["/errors", "/error-handling"],
  ])
    assert.equal(shown(source)[0], first, source);
  // Only matches are offered: no AIC block for /error, no test cases for /aic.
  assert.deepEqual(shown("/error"), ["/error-handling"]);
  assert.equal(shown("/aic").includes("/test-cases"), false);
  assert.deepEqual(shown("/list").slice(0, 2), ["/list", "/list-numbered"]);
  assert.equal(shown("/sec").includes("/aic"), true);
  assert.deepEqual(shown("/zzz"), []);
});

test("native Markdown finds the AIC block by its old security words", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    const source = "/security";
    const { items } = provider.provideCompletionItems(
      markdownDocument(source, path),
      new Position(0, source.length),
    );
    assert.equal(
      items.some(({ label }) => label === "/security"),
      false,
    );
    const item = items.find(({ label }) => label === "/aic");
    assert.equal(item.detail, "Blocks · AIC block (fields, secrets, codes)");
    assert.equal(items[0], item);
    assert.equal(item.filterText, "/security");
    assert.match(item.insertText.value, /^```aic\n/u);
  }
});

test("native Markdown excludes prose and fenced code but includes note Markdown", () => {
  assert.equal(
    nativeMarkdownSlashQuery(
      markdownDocument("text /section"),
      new Position(0, 13),
    ),
    null,
  );
  assert.deepEqual(
    nativeMarkdownSlashQuery(
      markdownDocument("/section", "/docs/readme.note.md"),
      new Position(0, 8),
    ),
    { text: "/section", startCharacter: 0, hasPageContent: false },
  );
  const fenced = markdownDocument("```text\n/section\n```");
  assert.equal(isInsideMarkdownFence(fenced, 1), true);
  assert.equal(nativeMarkdownSlashQuery(fenced, new Position(1, 8)), null);
  assert.equal(isInsideMarkdownFence(fenced, 3), false);
});

test("native Markdown uses the same Core templates for documents and notes", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    const document = markdownDocument("# Page\n\n## Subject\n\n/", path);
    const { items } = provider.provideCompletionItems(
      document,
      new Position(4, 1),
    );
    const valueOf = (command) =>
      items.find(({ label }) => label === command).insertText.value;
    assert.match(valueOf("/section"), /^### \$\{1:Title\}/u);
    assert.match(valueOf("/high-level-design"), /^### High-level design\n/u);
    assert.match(valueOf("/high-level-design"), /flowchart LR/u);
    assert.match(
      valueOf("/test-cases"),
      /^### Test cases\n[\s\S]*Scenario \/ precondition/u,
    );
    assert.match(valueOf("/state-diagram"), /^```mermaid\nstateDiagram-v2\n/u);
    for (const removed of ["/page", "/wave", "/noise", "/entity-map"])
      assert.equal(
        items.some(({ label }) => label === removed),
        false,
      );
  }
});

test("native documents and notes offer the same basic list and table blocks", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  const blocks = [
    ["list", "List", /^- \$\{1:/u],
    ["list-numbered", "Numbered list", /^1\. \$\{1:/u],
    ["table", "Table", /^\| \$\{1:Item\}/u],
  ];
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    for (const [command, title, pattern] of blocks) {
      const source = "/" + command;
      const position = new Position(0, source.length);
      const { items } = provider.provideCompletionItems(
        markdownDocument(source, path),
        position,
      );
      const item = items.find(({ label }) => label === source);
      assert.equal(item.filterText, source);
      assert.equal(item.detail, "Blocks · " + title);
      assert.match(item.insertText.value, pattern);
      assert.deepEqual(item.range, new Range(new Position(0, 0), position));
    }
  }
});

test("native provider registers for file and untitled Markdown with slash trigger", () => {
  let registration;
  const vscode = {
    ...fakeVscode,
    languages: {
      registerCompletionItemProvider(selector, provider, trigger) {
        registration = { selector, provider, trigger };
        return { dispose() {} };
      },
    },
  };
  registerMarkdownSlashCompletionProvider(vscode);
  assert.deepEqual(registration.selector, [{ language: "markdown" }]);
  assert.equal(registration.trigger, "/");
});

test("native .md and .note.md share one bare checklist discoverable by checkbox/tasklist", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    for (const command of ["checklist", "checkbox", "tasklist"]) {
      const source = "/" + command;
      const position = new Position(0, source.length);
      const { items } = provider.provideCompletionItems(
        markdownDocument(source, path),
        position,
      );
      const checklists = items.filter(({ label }) => label === "/checklist");
      assert.equal(checklists.length, 1);
      assert.equal(
        items.some(({ label }) => ["/checkbox", "/tasklist"].includes(label)),
        false,
      );
      const item = checklists[0];
      assert.equal(item.detail, "Blocks · Checklist");
      assert.equal(items[0], item);
      assert.equal(item.filterText, source);
      assert.equal(
        item.insertText.value,
        "- [ ] ${1:What needs to be done?}${0}",
      );
      assert.deepEqual(item.range, new Range(new Position(0, 0), position));
      assert.equal(
        items.some(({ label }) => label === "/tasks"),
        false,
      );
      const fenced = markdownDocument("~~~markdown\n" + source + "\n~~~", path);
      assert.equal(
        provider.provideCompletionItems(fenced, new Position(1, source.length)),
        undefined,
      );
      const inline = markdownDocument("`" + source + "`", path);
      assert.equal(
        provider.provideCompletionItems(
          inline,
          new Position(0, source.length + 1),
        ),
        undefined,
      );
    }
  }
});
