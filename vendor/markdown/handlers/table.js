// table — render a GFM pipe table as an aligned grid (owner 2026-06-19: "live
// rendered table … editable line by line"). Block widget in a StateField — the
// SAME pattern mermaid uses (CM6 requires block decorations outside
// ViewPlugins). Reveal rule: the cursor INSIDE the table shows the raw source
// (edit any line); OUTSIDE, the rendered grid. Markdown-internal (not a HANDLERS
// member, since those are mark/line decorations over view.visibleRanges).

import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { openLink } from "../link-tooltip.js";
import { fillCell } from "./cell-inline.js";

// cell inline-markdown rendering lives in the CM-free cell-inline.js (so
// node:test can cover it); links route through the SAME openLink as the
// link tooltip — scheme-less open the local file, external opens a new tab
function cell(el, text, host) {
  fillCell(el, text, host, openLink);
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

function previewHeader(label, onEdit) {
  const header = document.createElement("div");
  header.className = "cm-md-preview-header";
  const title = document.createElement("span");
  title.textContent = label;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "cm-md-edit-source";
  edit.textContent = "Edit source";
  edit.onmousedown = (event) => event.preventDefault();
  edit.onclick = (event) => {
    event.stopPropagation();
    onEdit();
  };
  header.append(title, edit);
  return header;
}

class TableWidget extends WidgetType {
  constructor(src, from, host) {
    super();
    this.src = src;
    this.from = from;
    this.host = host;
  }
  eq(other) {
    return other.src === this.src && other.from === this.from; // host is stable per session
  }
  toDOM(view) {
    const wrap = document.createElement("div");
    wrap.className = "cm-md-table cm-md-block-preview";
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "Markdown table preview");
    wrap.appendChild(
      previewHeader("Table", () => {
        view.dispatch({ selection: { anchor: this.from }, scrollIntoView: true });
        view.focus();
      }),
    );
    const data = parseTable(this.src);
    if (!data) {
      const fallback = document.createElement("pre");
      fallback.textContent = this.src; // unparseable — show it verbatim
      wrap.appendChild(fallback);
      return wrap;
    }
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    data.header.forEach((c, i) => {
      const th = document.createElement("th");
      cell(th, c, this.host);
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
        cell(td, row[i] ?? "", this.host);
        if (data.aligns[i]) td.style.textAlign = data.aligns[i];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  // Preview content is inert for source editing. Links and the explicit Edit
  // source button own their DOM actions; CodeMirror must never translate a
  // table-body click into a source selection.
  ignoreEvent() {
    return true;
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
          Decoration.replace({ widget: new TableWidget(src, t.from, host), block: true }).range(t.from, t.to),
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
