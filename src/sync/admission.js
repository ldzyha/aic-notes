function frontmatterBodyOffset(text) {
  const opening = /^---[ \t]*(?:\r\n|\n)/u.exec(text);
  if (!opening) return 0;

  let offset = opening[0].length;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const rawLine = text.slice(offset, end);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (/^---[ \t]*$/u.test(line)) {
      return newline < 0 ? end : newline + 1;
    }
    if (line.trim()) {
      const colon = line.indexOf(":");
      if (colon <= 0 || !line.slice(0, colon).trim()) return 0;
    }
    if (newline < 0) return 0;
    offset = newline + 1;
  }
  return 0;
}

export function noteBody(markdown) {
  const text = String(markdown ?? "");
  return text.slice(frontmatterBodyOffset(text));
}

function emptyChecklistScaffold(body) {
  const lines = body.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  let emptyTasks = 0;
  for (const line of lines) {
    if (/^#{1,6}(?:[ \t]+.*)?$/u.test(line)) continue;
    if (/^(?:[-*+]|\d+[.)])[ \t]+\[ \][ \t]*$/u.test(line)) {
      emptyTasks++;
      continue;
    }
    return false;
  }
  return emptyTasks > 0;
}

export function syncAdmission(markdown, placeholderMarkdown = "") {
  const body = noteBody(markdown);
  if (!body.trim()) return { admit: false, reason: "empty" };

  const placeholderBody = placeholderMarkdown ? noteBody(placeholderMarkdown) : "";
  if (placeholderBody && body.replaceAll("\r\n", "\n") === placeholderBody.replaceAll("\r\n", "\n")) {
    return { admit: false, reason: "placeholder" };
  }
  if (emptyChecklistScaffold(body)) {
    return { admit: false, reason: "empty" };
  }
  return { admit: true, reason: "substantive" };
}
