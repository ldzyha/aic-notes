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
  const fragment = endLine > line ? `#L${line}-L${endLine}` : `#L${line}`;
  const label = `${sourcePath}:${range}`;
  const href = `${encodeURIComponent(name)}${fragment}`;
  return { label, href, markdown: `[${escapeMarkdownLabel(label)}](${href})` };
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

/** Insert one deduplicated linked-code bullet and return its annotation caret offset. */
export function upsertLinkedCodeReference(noteText, reference) {
  const source = String(noteText ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const markdown = typeof reference === "string" ? reference : reference?.markdown;
  if (!markdown) throw new TypeError("upsertLinkedCodeReference needs a Markdown reference");

  const heading = /^##[ \t]+Linked code[ \t]*$/im.exec(source);
  if (!heading) {
    const prefix = source.trimEnd();
    const separator = prefix ? "\n\n" : "";
    const lead = `${prefix}${separator}${LINKED_CODE_HEADING}\n\n- ${markdown} — `;
    return { text: `${lead}\n`, cursor: lead.length, created: true };
  }

  const headingEnd = heading.index + heading[0].length;
  const tail = source.slice(headingEnd);
  const nextHeading = /^#{1,2}[ \t]+/m.exec(tail);
  const sectionEnd = nextHeading ? headingEnd + nextHeading.index : source.length;
  const existing = source.indexOf(markdown, headingEnd);
  if (existing >= 0 && existing < sectionEnd) {
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
  const lead = `${prefix}${gap}- ${markdown} — `;
  const suffix = nextHeading ? `\n\n${source.slice(sectionEnd).trimStart()}` : "\n";
  return { text: `${lead}${suffix}`, cursor: lead.length, created: true };
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
