// heading — `#` markers ride the reveal rule; the heading TEXT is sized per
// level (owner 2026-06-19: "titles must be bigger/smaller by level"). An
// INLINE mark carries the size (the proven pattern — the earlier letter-spacing
// styling rode the same mark): a height-changing LINE decoration would have to
// come from a state field, not this plugin. The size is CONSTANT (never
// reveal-gated), so a reveal still moves NO glyph — the zero-shift DoD holds.

import { Decoration } from "@codemirror/view";

const levelDeco = new Map(
  [1, 2, 3, 4, 5, 6].map((n) => [n, Decoration.mark({ class: `cm-md-h cm-md-h${n}` })]),
);
const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });

export const headingHandler = {
  id: "md.heading",
  nodes: ["ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const level = Number(nodeRef.name.slice(-1));
    const out = [];
    const mark = nodeRef.node.getChild("HeaderMark");
    if (mark) {
      out.push({
        from: mark.from,
        to: mark.to,
        deco: revealed(nodeRef.from, nodeRef.to) ? markerRevealed : marker,
      });
      if (mark.to < nodeRef.to) {
        // the heading text only — never the leading/trailing spaces
        let from = mark.to;
        let to = nodeRef.to;
        const text = view.state.sliceDoc(from, to);
        from += text.length - text.trimStart().length;
        to -= text.length - text.trimEnd().length;
        if (from < to) out.push({ from, to, deco: levelDeco.get(level) });
      }
    }
    return out;
  },
};
