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
  const document = markdownDocument("# Existing\n\n/hig");
  const position = new Position(2, 4);
  const query = nativeMarkdownSlashQuery(document, position);
  assert.deepEqual(query, {
    text: "/hig",
    startCharacter: 0,
    hasPageContent: true,
  });

  const items = createMarkdownSlashCompletionProvider(
    fakeVscode,
  ).provideCompletionItems(document, position);
  assert.equal(items.length, 18);
  const design = items.find(({ label }) => label === "/high-level-design");
  assert.equal(design.detail, "Sections · High-level design");
  assert.equal(design.filterText, "/high-level-design /high-level");
  assert.equal(design.insertText.value.includes("${1:"), true);
  assert.deepEqual(design.range, new Range(new Position(2, 0), position));
  const sortOf = (command) =>
    items.find(({ label }) => label === command).sortText;
  assert.equal(sortOf("/aic"), "00:aic");
  assert.equal(sortOf("/table"), "00:table");
  assert.equal(sortOf("/high-level-design"), "01:high-level-design");
  assert.equal(sortOf("/state-diagram"), "02:state-diagram");
  const empty = createMarkdownSlashCompletionProvider(
    fakeVscode,
  ).provideCompletionItems(markdownDocument("/"), new Position(0, 1));
  assert.deepEqual(
    empty.map(({ label, sortText, detail }) => [label, sortText, detail]),
    items.map(({ label, sortText, detail }) => [label, sortText, detail]),
  );
});

test("native Markdown finds the AIC block by its old security words", () => {
  const provider = createMarkdownSlashCompletionProvider(fakeVscode);
  for (const path of ["/docs/readme.md", "/docs/readme.note.md"]) {
    const source = "/security";
    const items = provider.provideCompletionItems(
      markdownDocument(source, path),
      new Position(0, source.length),
    );
    assert.equal(
      items.some(({ label }) => label === "/security"),
      false,
    );
    const item = items.find(({ label }) => label === "/aic");
    assert.equal(item.detail, "Blocks · AIC block (fields, secrets, codes)");
    assert.equal(
      item.filterText,
      "/aic /security /password /authenticator /two-factor /2fa /secret /fields /properties /credentials",
    );
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
    const items = provider.provideCompletionItems(document, new Position(4, 1));
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
      const items = provider.provideCompletionItems(
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
      assert.equal(item.detail, "Blocks · Checklist");
      assert.equal(item.filterText, "/checklist /checkbox /tasklist");
      assert.ok(item.filterText.includes(source));
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
