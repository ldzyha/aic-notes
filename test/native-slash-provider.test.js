import test from "node:test";
import assert from "node:assert/strict";
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

class SnippetString {
  constructor(value) {
    this.value = value;
  }
}

const fakeVscode = {
  Position,
  Range,
  CompletionItem,
  CompletionItemKind: { Snippet: 15 },
  SnippetString,
};

test("native Markdown uses the shared slash catalog and group order", () => {
  const document = markdownDocument("# Existing\n\n/com");
  const position = new Position(2, 4);
  const query = nativeMarkdownSlashQuery(document, position);
  assert.deepEqual(query, {
    text: "/com",
    startCharacter: 0,
    hasPageContent: true,
  });

  const items = createMarkdownSlashCompletionProvider(
    fakeVscode,
  ).provideCompletionItems(document, position);
  const comparison = items.find(({ label }) => label === "/comparison");
  assert.equal(
    comparison.detail,
    "Tables & lists · Current and target comparison",
  );
  assert.equal(comparison.insertText.value.includes("${1:"), true);
  assert.deepEqual(comparison.range, new Range(new Position(2, 0), position));
});

test("native Markdown excludes prose and fenced code but includes note Markdown", () => {
  assert.equal(
    nativeMarkdownSlashQuery(
      markdownDocument("text /page"),
      new Position(0, 10),
    ),
    null,
  );
  assert.deepEqual(
    nativeMarkdownSlashQuery(
      markdownDocument("/page", "/docs/readme.note.md"),
      new Position(0, 5),
    ),
    { text: "/page", startCharacter: 0, hasPageContent: false },
  );
  const fenced = markdownDocument("```text\n/page\n```");
  assert.equal(isInsideMarkdownFence(fenced, 1), true);
  assert.equal(nativeMarkdownSlashQuery(fenced, new Position(1, 5)), null);
  assert.equal(isInsideMarkdownFence(fenced, 3), false);
});

test("native Markdown uses the same Core templates for documents and notes", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    const document = markdownDocument("# Page\n\n## Subject\n\n/", path);
    const items = provider.provideCompletionItems(document, new Position(4, 1));
    const wave = items.find(({ label }) => label === "/wave");
    assert.match(wave.insertText.value, /^### Wave/u);
    assert.match(wave.insertText.value, /#### Instruction/u);
    assert.match(
      items.find(({ label }) => label === "/noise").insertText.value,
      /same note/u,
    );
    assert.match(
      items.find(({ label }) => label === "/entity-map").insertText.value,
      /flowchart TB/u,
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
      const items = provider.provideCompletionItems(
        markdownDocument(source, path),
        position,
      );
      const item = items.find(({ label }) => label === source);
      assert.equal(item.filterText, source);
      assert.equal(item.detail, "Tables & lists · " + title);
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
  assert.deepEqual(registration.selector, [
    { language: "markdown", scheme: "file" },
    { language: "markdown", scheme: "untitled" },
  ]);
  assert.equal(registration.trigger, "/");
});

test("native .md and .note.md share one bare checklist discoverable by checkbox/tasklist", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    for (const command of ["checklist", "checkbox", "tasklist"]) {
      const source = "/" + command;
      const position = new Position(0, source.length);
      const items = provider.provideCompletionItems(
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
      assert.equal(item.detail, "Tables & lists · Checklist");
      assert.equal(item.filterText, "/checklist /checkbox /tasklist");
      assert.ok(item.filterText.includes(source));
      assert.equal(
        item.insertText.value,
        "- [ ] ${1:What needs to be done?}${0}",
      );
      assert.deepEqual(item.range, new Range(new Position(0, 0), position));
      assert.match(
        items.find(({ label }) => label === "/tasks").insertText.value,
        /Verify the primary behavior/u,
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
