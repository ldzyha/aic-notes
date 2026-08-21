import { parseDetailsBlocks } from "../webview/details-model.js";

const LINKED_CODE_HEADING = "## Linked code";

function clampPosition(value, length) {
  return Math.max(0, Math.min(Number.isFinite(value) ? Math.trunc(value) : 0, length));
}

function lineAt(source, position) {
  let line = 1;
  for (
    let index = source.indexOf("\n");
    index >= 0 && index < position;
    index = source.indexOf("\n", index + 1)
  ) {
    line++;
  }
  return line;
}

/** Inclusive one-based lines touched by one non-empty UTF-16 editor selection. */
export function selectedLineRange(value, from, to) {
  const source = String(value ?? "");
  const start = clampPosition(Math.min(from, to), source.length);
  const end = clampPosition(Math.max(from, to), source.length);
  if (start === end) return null;
  const inclusiveEnd = source[end - 1] === "\n" ? end - 1 : end;
  return { line: lineAt(source, start), endLine: lineAt(source, inclusiveEnd) };
}

function escapeMarkdownLabel(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

/** Portable sibling link with a project-relative label and GitHub-style line fragment. */
export function linkedCodeReference(sourcePath, line, endLine = line) {
  if (
    !sourcePath ||
    !Number.isInteger(line) ||
    line < 1 ||
    !Number.isInteger(endLine) ||
    endLine < line
  ) {
    throw new TypeError("linkedCodeReference needs a path and a valid inclusive line range");
  }
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const range = endLine > line ? `${line}-${endLine}` : `${line}`;
  const compactRange = endLine > line ? `L${line}–L${endLine}` : `L${line}`;
  const fragment = endLine > line ? `#L${line}-L${endLine}` : `#L${line}`;
  const label = `${sourcePath}:${range}`;
  const href = `${encodeURIComponent(name)}${fragment}`;
  const compactLabel = `${name} · ${compactRange}`;
  return {
    label,
    href,
    markdown: `[${escapeMarkdownLabel(label)}](${href})`,
    compactLabel,
    compactMarkdown: `[${escapeMarkdownLabel(compactLabel)}](${href})`,
  };
}

const LANGUAGE_BY_EXTENSION = new Map([
  ["c", "c"], ["cc", "cpp"], ["cpp", "cpp"], ["cs", "csharp"], ["css", "css"],
  ["go", "go"], ["html", "html"], ["java", "java"], ["js", "javascript"],
  ["json", "json"], ["jsx", "jsx"], ["md", "markdown"], ["mjs", "javascript"],
  ["py", "python"], ["rb", "ruby"], ["rs", "rust"], ["scss", "scss"], ["sh", "bash"],
  ["sql", "sql"], ["ts", "typescript"], ["tsx", "tsx"], ["xml", "xml"],
  ["yaml", "yaml"], ["yml", "yaml"],
]);

export function languageForSourcePath(sourcePath) {
  const name = String(sourcePath ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "";
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return LANGUAGE_BY_EXTENSION.get(extension) ?? "";
}

export function fencedSelection(value, language = "") {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  let longest = 0;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

/** Canonical owner/note route for an ordinary source or an AIC *.ai.md artifact. */
export function noteTargetForSource(value) {
  const sourcePath = typeof value === "string"
    ? value.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/^\/+|\/+$/g, "")
    : "";
  if (!sourcePath || sourcePath.startsWith("untitled:") || sourcePath.endsWith(".note.md")) {
    return null;
  }
  const ai = sourcePath.endsWith(".ai.md");
  const ownerPath = ai ? sourcePath.slice(0, -".ai.md".length) : sourcePath;
  if (!ownerPath) return null;
  const slash = ownerPath.lastIndexOf("/");
  const name = slash >= 0 ? ownerPath.slice(slash + 1) : ownerPath;
  const dot = name.lastIndexOf(".");
  const notePath = dot <= 0
    ? `${ownerPath}.note.md`
    : `${ownerPath.slice(0, ownerPath.length - (name.length - dot))}.note.md`;
  return { sourcePath, ownerPath, notePath, ai };
}

function hrefNeedle(reference) {
  return `](${reference.href})`;
}

function commentCursor(source, from, to) {
  const label = "**Comment**";
  const at = source.indexOf(label, from);
  if (at < 0 || at >= to) return to;
  let cursor = at + label.length;
  if (source.slice(cursor, cursor + 2) === "\n\n") cursor += 2;
  else if (source[cursor] === "\n") cursor += 1;
  return cursor;
}

function linkedCodeSectionEnd(source, headingEnd, details) {
  const headings = /^#{1,2}[ \t]+/gmu;
  headings.lastIndex = headingEnd;
  for (let match = headings.exec(source); match; match = headings.exec(source)) {
    const insideDetail = details.some((detail) => match.index >= detail.from && match.index < detail.end);
    if (!insideDetail) return match.index;
  }
  return source.length;
}

/** Insert one deduplicated linked-code details block and return its comment caret offset. */
export function upsertLinkedCodeReference(noteText, reference, selectedText = "") {
  const source = String(noteText ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const markdown = reference?.markdown;
  const compactMarkdown = reference?.compactMarkdown;
  if (!markdown || !compactMarkdown || !reference?.href) {
    throw new TypeError("upsertLinkedCodeReference needs a linked-code reference");
  }

  const heading = /^##[ \t]+Linked code[ \t]*$/im.exec(source);
  if (!heading) {
    const prefix = source.trimEnd();
    const separator = prefix ? "\n\n" : "";
    const block = linkedDetailsBlock(reference, selectedText);
    const lead = `${prefix}${separator}${LINKED_CODE_HEADING}\n\n${block.prefix}`;
    return { text: `${lead}${block.suffix}\n`, cursor: lead.length, created: true };
  }

  const headingEnd = heading.index + heading[0].length;
  const details = parseDetailsBlocks(source);
  const sectionEnd = linkedCodeSectionEnd(source, headingEnd, details);
  const existing = source.indexOf(hrefNeedle(reference), headingEnd);
  if (existing >= 0 && existing < sectionEnd) {
    const detail = details.find(
      (candidate) => candidate.from >= headingEnd && candidate.to <= sectionEnd &&
        source.slice(candidate.headerFrom, candidate.headerTo).includes(hrefNeedle(reference)),
    );
    if (detail) {
      let text = source;
      let cursor = commentCursor(source, detail.contentFrom, detail.contentTo);
      if (!detail.open) {
        const header = source.slice(detail.headerFrom, detail.headerTo);
        const opened = header.replace(/^>>>[ \t]+/u, ">>>|open| ");
        text = source.slice(0, detail.headerFrom) + opened + source.slice(detail.headerTo);
        const delta = opened.length - header.length;
        cursor += delta;
      }
      return { text, cursor, created: false, opened: !detail.open };
    }
    const lineEnd = source.indexOf("\n", existing + markdown.length);
    return {
      text: source,
      cursor: lineEnd >= 0 && lineEnd <= sectionEnd ? lineEnd : sectionEnd,
      created: false,
    };
  }
  const prefix = source.slice(0, sectionEnd).trimEnd();
  const hasSectionContent = source.slice(headingEnd, sectionEnd).trim().length > 0;
  const gap = hasSectionContent ? "\n" : "\n\n";
  const block = linkedDetailsBlock(reference, selectedText);
  const lead = `${prefix}${gap}${block.prefix}`;
  const suffix = `${block.suffix}${sectionEnd < source.length ? `\n\n${source.slice(sectionEnd).trimStart()}` : "\n"}`;
  return { text: `${lead}${suffix}`, cursor: lead.length, created: true };
}

export function linkedDetailsBlock(reference, selectedText) {
  const language = languageForSourcePath(reference.label.split(":", 1)[0]);
  const code = fencedSelection(selectedText, language);
  const prefix = `>>>|open| - [ ] ${reference.compactMarkdown}\n${code}\n\n**Comment**\n\n`;
  return { prefix, suffix: "\n<<<", cursor: prefix.length };
}

/** Parse only a valid inclusive #Lx or #Lx-Ly range. */
export function sourceLocationFromHref(value) {
  const href = String(value ?? "").trim();
  const hashAt = href.indexOf("#");
  const queryAt = href.indexOf("?");
  const pathEnd = [hashAt, queryAt]
    .filter((index) => index >= 0)
    .reduce((left, right) => Math.min(left, right), href.length);
  const encodedPath = href.slice(0, pathEnd);
  let path = encodedPath;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    // Keep the original path; the caller will fail safely if it does not exist.
  }
  const fragment = hashAt >= 0 ? href.slice(hashAt + 1).split("?", 1)[0] : "";
  const match = /^L([1-9]\d*)(?:-L?([1-9]\d*))?$/iu.exec(fragment);
  if (!match) return { path, line: null, endLine: null };
  const line = Number(match[1]);
  const endLine = match[2] ? Number(match[2]) : line;
  if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || endLine < line) {
    return { path, line: null, endLine: null };
  }
  return { path, line, endLine };
}
