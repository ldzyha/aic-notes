const CHECKLIST_BODY = "- [ ]\n";

function frontmatterEnd(text) {
  const opening = /^---[ \t]*(?:\r\n|\n)/u.exec(text);
  if (!opening) return -1;

  let offset = opening[0].length;
  let keys = 0;
  while (offset <= text.length) {
    const newline = text.indexOf("\n", offset);
    const end = newline < 0 ? text.length : newline;
    const rawLine = text.slice(offset, end);
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (/^---[ \t]*$/u.test(line)) {
      return keys > 0 ? (newline < 0 ? end : newline + 1) : -1;
    }
    if (line.trim()) {
      const colon = line.indexOf(":");
      if (colon <= 0 || !line.slice(0, colon).trim()) return -1;
      keys++;
    }
    if (newline < 0) return -1;
    offset = newline + 1;
  }
  return -1;
}

export function clearNoteContent(markdown) {
  const text = String(markdown ?? "");
  const end = frontmatterEnd(text);
  if (end < 0) return CHECKLIST_BODY;
  const prefix = text.slice(0, end);
  return `${prefix}${prefix.endsWith("\n") ? "" : "\n"}${CHECKLIST_BODY}`;
}

export const noteActionContract = Object.freeze({ checklistBody: CHECKLIST_BODY });
