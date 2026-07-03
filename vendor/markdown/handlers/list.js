// list — bullet/ordered/task markers; toggles for the three list kinds
// (Mod-Shift-7/8/9); Enter continues a list (ordered runs renumber); the
// task marker renders as a real checkbox. The widget is the ONE sanctioned
// replace decoration: it spans exactly the 3 source chars and its advance
// width is exactly 3ch, so reveal cannot shift glyphs (guide §1).

import { Decoration, WidgetType } from "@codemirror/view";

const listMark = Decoration.mark({ class: "cm-md-listmark" });

class TaskWidget extends WidgetType {
  constructor(checked) {
    super();
    this.checked = checked;
  }
  eq(other) {
    return other.checked === this.checked;
  }
  ignoreEvent() {
    return true; // the widget owns its pointer events (no cursor placement)
  }
  toDOM(view) {
    const wrap = document.createElement("span");
    wrap.className = "cm-md-task" + (this.checked ? " checked" : "");
    wrap.setAttribute("role", "checkbox");
    wrap.setAttribute("aria-checked", String(this.checked));
    const box = document.createElement("span");
    box.className = "cm-md-task-box";
    wrap.appendChild(box);
    wrap.onmousedown = (e) => e.preventDefault(); // never steal editor focus
    wrap.onclick = () => {
      const pos = view.posAtDOM(wrap);
      const m = /^\[([ xX])\]$/.exec(view.state.sliceDoc(pos, pos + 3));
      if (!m) return;
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: m[1] === " " ? "x" : " " },
      });
    };
    return wrap;
  }
}

const taskChecked = Decoration.replace({ widget: new TaskWidget(true) });
const taskUnchecked = Decoration.replace({ widget: new TaskWidget(false) });

// one line shape: indent, list marker (bullet or "1."/"1)"), task box, content
function parseLine(text) {
  const m = /^(\s*)(?:([-*+]|\d+[.)])(\s+))?(\[[ xX]\]\s+)?(.*)$/.exec(text);
  return {
    indent: m[1],
    marker: m[2] ?? null,
    space: m[3] ?? " ",
    task: m[2] ? (m[4] ?? null) : null, // a box without a marker is content
    content: m[2] ? m[5] : (m[4] ?? "") + m[5],
  };
}

function kindOf(p) {
  if (!p.marker) return null;
  if (p.task) return "task";
  return /^\d/.test(p.marker) ? "ordered" : "bullet";
}

function toggleLines(view, kind) {
  const { from, to } = view.state.selection.main;
  const startLine = view.state.doc.lineAt(from);
  const endLine = view.state.doc.lineAt(to);
  const lines = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    const line = view.state.doc.line(n);
    if (line.text.trim()) lines.push(line);
  }
  // an all-blank selection (the common case: a cursor on an EMPTY line): still
  // create the marker on the cursor's line so a task/list can START on a blank
  // line (owner 2026-06-19: "не дає створити чекбокс для пустого рядку")
  const blankStart = !lines.length;
  if (blankStart) lines.push(startLine);
  const all = lines.every((l) => kindOf(parseLine(l.text)) === kind);
  const changes = [];
  let num = 1;
  for (const line of lines) {
    const p = parseLine(line.text);
    const head = line.text.length - p.content.length;
    let insert;
    if (all) insert = p.indent; // strip back to plain content
    else if (kind === "bullet") insert = `${p.indent}- `;
    else if (kind === "ordered") insert = `${p.indent}${num++}. `;
    else insert = `${p.indent}- ${p.task ?? "[ ] "}`; // keep an existing box
    if (insert !== line.text.slice(0, head)) {
      changes.push({ from: line.from, to: line.from + head, insert });
    }
  }
  if (changes.length) {
    const spec = { changes, userEvent: "input" };
    // a marker freshly created on a blank line: drop the caret AFTER it, ready
    // to type the item (else CM leaves it before the inserted marker)
    if (blankStart && !all && changes.length === 1) {
      spec.selection = { anchor: changes[0].from + changes[0].insert.length };
    }
    view.dispatch(spec);
  }
  view.focus();
}

// renumber the contiguous same-indent ordered run BELOW lineNo so it
// continues from num — pure over a state, exported for /selftest
export function renumberAfter(state, lineNo, num, indent) {
  const changes = [];
  for (let n = lineNo + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const m = /^(\s*)(\d+)([.)])\s/.exec(line.text);
    if (!m || m[1] !== indent) break;
    if (parseInt(m[2], 10) !== num) {
      changes.push({
        from: line.from + m[1].length,
        to: line.from + m[1].length + m[2].length,
        insert: String(num),
      });
    }
    num++;
  }
  return changes;
}

// Enter inside a list item continues the list; Enter on an EMPTY item
// strips the marker (the standard exit). Composed into the session keymap
// with Prec.high (the session compartment sits after the base keymap).
function continueList(view) {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const p = parseLine(line.text);
  if (!p.marker) return false;
  const contentStart = line.from + line.text.length - p.content.length;
  if (sel.head < contentStart) return false; // before the marker: default Enter
  if (!p.content.trim()) {
    // empty item: exit the list
    view.dispatch({
      changes: { from: line.from + p.indent.length, to: line.to },
      userEvent: "delete",
    });
    return true;
  }
  const ordered = /^\d/.test(p.marker);
  let marker;
  if (ordered) {
    const n = parseInt(p.marker, 10) + 1;
    marker = `${p.indent}${n}${p.marker.endsWith(")") ? ")" : "."}${p.space}`;
  } else {
    marker = `${p.indent}${p.marker}${p.space}`;
  }
  if (p.task) marker += "[ ] ";
  const insert = "\n" + marker;
  const changes = [{ from: sel.head, insert }];
  if (ordered) {
    changes.push(...renumberAfter(view.state, line.number, parseInt(p.marker, 10) + 2, p.indent));
  }
  view.dispatch({
    changes,
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

// Space toggles the box ONLY when the cursor sits on the marker (exactly
// the zone where the reveal rule already shows the source); anywhere else
// it falls through and types a space.
function spaceToggle(view) {
  const sel = view.state.selection.main;
  if (!sel.empty) return false;
  const line = view.state.doc.lineAt(sel.head);
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text);
  if (!m) return false;
  const markerFrom = line.from + m[1].length;
  if (sel.head < markerFrom || sel.head > markerFrom + 3) return false;
  view.dispatch({
    changes: { from: markerFrom + 1, to: markerFrom + 2, insert: m[2] === " " ? "x" : " " },
    userEvent: "input",
  });
  return true;
}

export const listKeymap = [
  { key: "Enter", run: continueList },
  { key: " ", run: spaceToggle },
];

export const listHandler = {
  id: "md.list",
  nodes: ["ListMark", "TaskMarker"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    if (nodeRef.name === "TaskMarker") {
      if (revealed(nodeRef.from, nodeRef.to)) {
        return [{ from: nodeRef.from, to: nodeRef.to, deco: listMark }];
      }
      const checked = /x/i.test(view.state.sliceDoc(nodeRef.from, nodeRef.to));
      return [{ from: nodeRef.from, to: nodeRef.to, deco: checked ? taskChecked : taskUnchecked }];
    }
    return [{ from: nodeRef.from, to: nodeRef.to, deco: listMark }];
  },
  commands: {
    "md.list.toggle": (view) => toggleLines(view, "bullet"), // kept: the original id
    "md.list.bullet": (view) => toggleLines(view, "bullet"),
    "md.list.ordered": (view) => toggleLines(view, "ordered"),
    "md.list.task": (view) => toggleLines(view, "task"),
    // loose predicate on purpose: palette/touch invocation carries intent
    "md.task.toggle": (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text);
      if (!m) return;
      const from = line.from + m[1].length + 1;
      view.dispatch({
        changes: { from, to: from + 1, insert: m[2] === " " ? "x" : " " },
        userEvent: "input",
      });
      view.focus();
    },
  },
};
