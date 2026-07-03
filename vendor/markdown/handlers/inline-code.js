// inline-code — backtick reveal + chip background (no font change: the
// editor is monospace throughout, so no metric shift).

import { Decoration } from "@codemirror/view";
import { toggleWrap } from "./emphasis.js";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });
const code = Decoration.mark({ class: "cm-md-code" });

export const inlineCodeHandler = {
  id: "md.inline-code",
  nodes: ["InlineCode"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const out = [];
    const rev = revealed(nodeRef.from, nodeRef.to);
    const marks = nodeRef.node.getChildren("CodeMark");
    for (const m of marks) {
      out.push({ from: m.from, to: m.to, deco: rev ? markerRevealed : marker });
    }
    if (marks.length === 2 && marks[0].to < marks[1].from) {
      out.push({ from: marks[0].to, to: marks[1].from, deco: code });
    }
    return out;
  },
  commands: { "md.code.toggle": (view) => toggleWrap(view, "`") },
};
