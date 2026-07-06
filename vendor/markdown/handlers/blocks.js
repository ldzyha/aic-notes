// blockquote, hr, strikethrough — small block/inline handlers (one
// concern each; grouped in a file only because each is a few lines).

import { Decoration } from "@codemirror/view";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });
const quote = Decoration.mark({ class: "cm-md-quote" });
const strike = Decoration.mark({ class: "cm-md-strike" });
const hr = Decoration.mark({ class: "cm-md-hr" });
const hrLine = Decoration.line({ class: "cm-md-hr-line" });

export const blockquoteHandler = {
  id: "md.blockquote",
  nodes: ["QuoteMark"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const line = view.state.doc.lineAt(nodeRef.from);
    return [
      {
        from: nodeRef.from,
        to: nodeRef.to,
        deco: revealed(line.from, line.to) ? markerRevealed : marker,
      },
      ...(nodeRef.to < line.to ? [{ from: nodeRef.to, to: line.to, deco: quote }] : []),
    ];
  },
};

// hr renders as a REAL horizontal rule (owner 2026-07-06: "--- is not
// visible"): the line gets .cm-md-hr-line (CSS draws a full-width rule) and
// the dashes go transparent; the caret on the line reveals the raw source
export const hrHandler = {
  id: "md.hr",
  nodes: ["HorizontalRule"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const line = view.state.doc.lineAt(nodeRef.from);
    if (revealed(line.from, line.to)) {
      return [{ from: nodeRef.from, to: nodeRef.to, deco: markerRevealed }];
    }
    return [
      { from: line.from, to: line.from, deco: hrLine, line: true },
      { from: nodeRef.from, to: nodeRef.to, deco: hr },
    ];
  },
};

export const strikethroughHandler = {
  id: "md.strikethrough",
  nodes: ["Strikethrough"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const out = [];
    const rev = revealed(nodeRef.from, nodeRef.to);
    const marks = nodeRef.node.getChildren("StrikethroughMark");
    for (const m of marks) {
      out.push({ from: m.from, to: m.to, deco: rev ? markerRevealed : marker });
    }
    if (marks.length === 2 && marks[0].to < marks[1].from) {
      out.push({ from: marks[0].to, to: marks[1].from, deco: strike });
    }
    return out;
  },
};
