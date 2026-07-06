// Inline markdown inside a table cell (owner 2026-07-06: "syntax in the
// table"): code spans, links, bold, strike, italic — recursive, so
// **[a](b)** nests. Deliberately CM-free (no @codemirror imports) so
// node:test can drive it with a DOM stub; table.js supplies the link-click
// behavior (openLink) as a parameter.
// Alternation order = precedence: code beats everything, links beat emphasis.

const CELL_INLINE =
  /(`([^`]+)`)|(\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*]+)\*)|(_([^_]+)_)/g;

export function fillCell(td, text, host, openLink) {
  // a FRESH regex per call: fillCell recurses, and a shared /g regex carries
  // its cursor in lastIndex — the recursive call rewinding it to 0 made the
  // OUTER loop re-match its first token forever (v0.5.1 froze the window on
  // any cell with a link/emphasis)
  const inline = new RegExp(CELL_INLINE.source, "g");
  let last = 0;
  let match;
  while ((match = inline.exec(text)) !== null) {
    if (match.index > last) td.appendChild(document.createTextNode(text.slice(last, match.index)));
    if (match[2] !== undefined) {
      const code = document.createElement("code");
      code.className = "cm-md-code";
      code.textContent = match[2];
      td.appendChild(code);
    } else if (match[5] !== undefined) {
      const url = match[5];
      const a = document.createElement("a");
      a.className = "cm-md-table-link";
      a.href = url;
      a.title = url;
      a.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation(); // don't let CM place the cursor / reveal the row
        openLink?.(url, host);
      };
      if (match[4]) fillCell(a, match[4], host, openLink);
      else a.textContent = url;
      td.appendChild(a);
    } else if (match[7] !== undefined || match[9] !== undefined) {
      const strong = document.createElement("strong");
      fillCell(strong, match[7] ?? match[9], host, openLink);
      td.appendChild(strong);
    } else if (match[11] !== undefined) {
      const del = document.createElement("del");
      fillCell(del, match[11], host, openLink);
      td.appendChild(del);
    } else {
      const em = document.createElement("em");
      fillCell(em, match[13] ?? match[15], host, openLink);
      td.appendChild(em);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) td.appendChild(document.createTextNode(text.slice(last)));
}
