import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import {
  DOCUMENTATION_SNIPPETS,
  slashSnippetCompletions,
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

/**
 * The catalogue entries that match the typed `/word`, best first. Matching
 * and order are the shared core's: the command, then its aliases, then loose
 * matches; a bare `/` lists the whole catalogue in its own order.
 */
export function nativeSlashMatches(text) {
  const result = slashSnippetCompletions(
    new CompletionContext(EditorState.create({ doc: text }), text.length, true),
  );
  const byCommand = new Map(
    DOCUMENTATION_SNIPPETS.map((entry) => [entry.command, entry]),
  );
  return (result?.options ?? []).map(({ label }) =>
    byCommand.get(label.slice(1)),
  );
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
      const items = nativeSlashMatches(query.text).map((entry, order) => {
        const item = new vscode.CompletionItem(
          "/" + entry.command,
          vscode.CompletionItemKind.Snippet,
        );
        const section = sections[entry.group];
        item.detail = `${section.name} · ${entry.title}`;
        // VS Code scores items by filterText before it reads sortText. Every
        // item here already matches, so all get the typed text and the same
        // score: the order below is the order shown.
        item.filterText = query.text;
        item.insertText = new vscode.SnippetString(
          slashSnippetTemplate(entry, sourceBeforeCursor),
        );
        item.range = range;
        item.sortText = String(order).padStart(2, "0");
        return item;
      });
      // Incomplete: the next keystroke asks again instead of re-filtering.
      return new vscode.CompletionList(items, true);
    },
  };
}

export function registerMarkdownSlashCompletionProvider(vscode) {
  return vscode.languages.registerCompletionItemProvider(
    [{ language: "markdown" }],
    createMarkdownSlashCompletionProvider(vscode),
    "/",
  );
}
