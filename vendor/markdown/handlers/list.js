// list — bullet/ordered/task markers; toggles for the three list kinds
// (Mod-Shift-7/8/9); Enter continues a list (ordered runs renumber); the
// task marker renders as a real checkbox. Raw Space remains ordinary text so
// typing after "- [ ]" can complete the parser-required whitespace. The
// widget is the ONE sanctioned replace decoration: it spans exactly the 3
// source chars and its advance width is exactly 3ch, so reveal cannot shift
// glyphs (guide §1).

import { Decoration } from "@codemirror/view";
import {
  parseListLine as parseLine,
  toggleList,
} from "../../aic-editor-core/formatting.js";

const listMark = Decoration.mark({ class: "cm-md-listmark" });

import {
  TaskMarkerWidget,
  toggleTaskMarker,
} from "../../aic-editor-core/task-marker.js";

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
  if (view.state.readOnly) return false;
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
    changes.push(
      ...renumberAfter(
        view.state,
        line.number,
        parseInt(p.marker, 10) + 2,
        p.indent,
      ),
    );
  }
  view.dispatch({
    changes,
    selection: { anchor: sel.head + insert.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

export const listKeymap = [{ key: "Enter", run: continueList }];

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
      return [
        {
          from: nodeRef.from,
          to: nodeRef.to,
          deco: Decoration.replace({
            widget: new TaskMarkerWidget(
              nodeRef.from,
              checked,
              view.state.readOnly,
            ),
          }),
        },
      ];
    }
    return [{ from: nodeRef.from, to: nodeRef.to, deco: listMark }];
  },
  commands: {
    "md.list.toggle": (view) => toggleList(view, "bullet"), // kept: the original id
    "md.list.bullet": (view) => toggleList(view, "bullet"),
    "md.list.ordered": (view) => toggleList(view, "ordered"),
    "md.list.task": (view) => toggleList(view, "task"),
    // loose predicate on purpose: palette/touch invocation carries intent
    "md.task.toggle": (view) => {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text);
      if (!m) return;
      if (toggleTaskMarker(view, line.from + m[1].length)) view.focus();
    },
  },
};
