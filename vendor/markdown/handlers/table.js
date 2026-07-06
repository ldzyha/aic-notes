// table — render a GFM pipe table as an aligned grid (owner 2026-06-19: "live
// rendered table … editable line by line"). Block widget in a StateField — the
// SAME pattern mermaid uses (CM6 requires block decorations outside
// ViewPlugins). Reveal rule: the cursor INSIDE the table shows the raw source
// (edit any line); OUTSIDE, the rendered grid. Markdown-internal (not a HANDLERS
// member, since those are mark/line decorations over view.visibleRanges).

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { mermaidFences } from "../mermaid.js";
import { openLink } from "../link-tooltip.js";

// render a cell's inline markdown (owner 2026-07-06: "syntax in the table"):
// code spans, links, bold, strike, italic — recursive, so **[a](b)** nests.
// Links stay clickable <a>: scheme-less open the local file via host.bus (the
// SAME routing as the link tooltip); external/anchor links open a new tab.
// Alternation order = precedence: code beats everything, links beat emphasis.
const CELL_INLINE =
  /(`([^`]+)`)|(\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(~~([^~]+)~~)|(\*([^*]+)\*)|(_([^_]+)_)/g;
function fillCell(td, text, host) {
  CELL_INLINE.lastIndex = 0;
  let last = 0;
  let match;
  while ((match = CELL_INLINE.exec(text)) !== null) {
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
        openLink(url, host);
      };
      if (match[4]) fillCell(a, match[4], host);
      else a.textContent = url;
      td.appendChild(a);
    } else if (match[7] !== undefined || match[9] !== undefined) {
      const strong = document.createElement("strong");
      fillCell(strong, match[7] ?? match[9], host);
      td.appendChild(strong);
    } else if (match[11] !== undefined) {
      const del = document.createElement("del");
      fillCell(del, match[11], host);
      td.appendChild(del);
    } else {
      const em = document.createElement("em");
      fillCell(em, match[13] ?? match[15], host);
      td.appendChild(em);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) td.appendChild(document.createTextNode(text.slice(last)));
}

// split a pipe row into trimmed cells, dropping the empties the leading/trailing
// `|` produce (a pipe inside a cell would need escaping — a preview stays simple)
function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/) // a backslash-escaped pipe stays INSIDE one cell (GFM)
    .map((c) => c.trim().replace(/\\\|/g, "|")); // then unescape \| → |
}

function parseTable(src) {
  const lines = src.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return null; // header + delimiter at minimum
  const header = splitRow(lines[0]);
  const aligns = splitRow(lines[1]).map((d) => {
    const l = d.startsWith(":");
    const r = d.endsWith(":");
    return l && r ? "center" : r ? "right" : l ? "left" : "";
  });
  const rows = lines.slice(2).map(splitRow);
  return { header, aligns, rows };
}

class TableWidget extends WidgetType {
  constructor(src, host) {
    super();
    this.src = src;
    this.host = host;
  }
  eq(other) {
    return other.src === this.src; // host is stable per session
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table";
    const data = parseTable(this.src);
    if (!data) {
      wrap.textContent = this.src; // unparseable — show it verbatim
      return wrap;
    }
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    data.header.forEach((c, i) => {
      const th = document.createElement("th");
      fillCell(th, c, this.host);
      if (data.aligns[i]) th.style.textAlign = data.aligns[i];
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const row of data.rows) {
      const tr = document.createElement("tr");
      data.header.forEach((_, i) => {
        const td = document.createElement("td");
        fillCell(td, row[i] ?? "", this.host);
        if (data.aligns[i]) td.style.textAlign = data.aligns[i];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  // a click on a LINK is handled by the link itself (navigate) — tell CM to
  // IGNORE it so it does NOT place the cursor and reveal the raw table (owner
  // 2026-06-19: a table-link click must OPEN, not edit). A click anywhere else
  // passes through → cursor placement → reveal for editing.
  ignoreEvent(event) {
    return !!event?.target?.closest?.(".cm-md-table-link");
  }
}

export function tableNodes(state) {
  const out = [];
  try {
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "Table") out.push({ from: node.from, to: node.to });
      },
    });
  } catch {
    // a half-parsed tree mid-edit — skip; the next update rebuilds
  }
  return out;
}

export function makeTableExtension(host) {
  function build(state) {
    const head = state.selection.main.head;
    const decorations = [];
    for (const t of tableNodes(state)) {
      const inside = head >= t.from && head <= t.to; // boundaries count → reveal
      const src = state.sliceDoc(t.from, t.to);
      if (!inside && src.trim()) {
        decorations.push(
          Decoration.replace({ widget: new TableWidget(src, host), block: true }).range(t.from, t.to),
        );
      }
    }
    return Decoration.set(decorations, true);
  }
  return StateField.define({
    create: (state) => build(state),
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value;
      return build(tr.state);
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

// arrow INTO a rendered block (owner 2026-06-19): moving the caret down/up onto
// a table or mermaid block ENTERS it for editing — the same as clicking it —
// instead of the caret skipping the replaced block. Landing the caret inside
// the block's range fires its reveal (the table shows raw pipes; the mermaid
// fence shows raw source). Bound at Prec.high in the session so it beats the
// default cursorLineUp/Down.
function blocksOutsideCursor(state) {
  const head = state.selection.main.head;
  const blocks = [];
  for (const t of tableNodes(state)) blocks.push(t);
  for (const f of mermaidFences(state)) {
    if (state.sliceDoc(f.from, f.to).trim()) blocks.push({ from: f.from, to: f.to });
  }
  // only blocks the caret is NOT already inside (those are already revealed)
  return blocks.filter((b) => head < b.from || head > b.to);
}

function arrowIntoBlock(view, dir) {
  const { state } = view;
  if (!state.selection.main.empty) return false; // a selection — leave default
  const head = state.selection.main.head;
  // where the DEFAULT vertical move would land — GEOMETRY, not doc lines, so a
  // wrapped long line's intermediate rows don't teleport (review 2026-06-19).
  const target = view.moveVertically(state.selection.main, dir === 1).head;
  // intercept only when that move would reach/cross a rendered block (the caret
  // is OUTSIDE it and the move arrives at or past its near edge) — then land the
  // caret inside so the block's reveal fires; else let the default move run
  const block = blocksOutsideCursor(state).find((b) =>
    dir === 1 ? head < b.from && target >= b.from : head > b.to && target <= b.to,
  );
  if (!block) return false;
  view.dispatch({
    selection: { anchor: dir === 1 ? block.from : block.to },
    scrollIntoView: true,
  });
  return true;
}

export const blockEnterKeymap = [
  { key: "ArrowDown", run: (v) => arrowIntoBlock(v, 1) },
  { key: "ArrowUp", run: (v) => arrowIntoBlock(v, -1) },
];
