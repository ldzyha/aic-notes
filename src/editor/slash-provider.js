import {
  DOCUMENTATION_SNIPPETS,
  slashSnippetSearchText,
  slashSnippetSections,
  slashSnippetTemplate,
  slashSnippetToken,
} from "../../vendor/aic-editor-core/slash-snippets.js";

function fenceRun(line) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
  if (!match) return null;
  return {
    marker: match[1][0],
    length: match[1].length,
    tail: match[2],
  };
}

export function isInsideMarkdownFence(document, lineNumber) {
  let open = null;
  for (let index = 0; index < lineNumber; index++) {
    const run = fenceRun(document.lineAt(index).text);
    if (!run) continue;
    if (!open) {
      open = run;
      continue;
    }
    if (
      run.marker === open.marker &&
      run.length >= open.length &&
      !run.tail.trim()
    )
      open = null;
  }
  return Boolean(open);
}

export function nativeMarkdownSlashQuery(document, position) {
  const before = document
    .lineAt(position.line)
    .text.slice(0, position.character);
  const text = slashSnippetToken(before);
  if (!text || isInsideMarkdownFence(document, position.line)) return null;
  const offset = document.offsetAt(position);
  const source = document.getText();
  return Object.freeze({
    text,
    startCharacter: position.character - text.length,
    hasPageContent:
      source
        .slice(0, offset - text.length)
        .concat(source.slice(offset))
        .trim().length > 0,
  });
}

export function createMarkdownSlashCompletionProvider(vscode) {
  return {
    provideCompletionItems(document, position) {
      const query = nativeMarkdownSlashQuery(document, position);
      if (!query) return undefined;
      const sections = slashSnippetSections(query.hasPageContent);
      const sourceBeforeCursor = document
        .getText()
        .slice(0, document.offsetAt(position) - query.text.length);
      const range = new vscode.Range(
        new vscode.Position(position.line, query.startCharacter),
        position,
      );
      return DOCUMENTATION_SNIPPETS.map((entry) => {
        const item = new vscode.CompletionItem(
          "/" + entry.command,
          vscode.CompletionItemKind.Snippet,
        );
        const section = sections[entry.group];
        item.detail = `${section.name} · ${entry.title}`;
        item.filterText = slashSnippetSearchText(entry);
        item.insertText = new vscode.SnippetString(
          slashSnippetTemplate(entry, sourceBeforeCursor),
        );
        item.range = range;
        item.sortText = `${String(section.rank).padStart(2, "0")}:${entry.command}`;
        return item;
      });
    },
  };
}

export function registerMarkdownSlashCompletionProvider(vscode) {
  return vscode.languages.registerCompletionItemProvider(
    [
      { language: "markdown", scheme: "file" },
      { language: "markdown", scheme: "untitled" },
    ],
    createMarkdownSlashCompletionProvider(vscode),
    "/",
  );
}
