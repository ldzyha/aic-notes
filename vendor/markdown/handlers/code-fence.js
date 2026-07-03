// code-fence — fence markers under the reveal rule, code body on a chip
// background. Nested syntax highlighting of fence languages is DEFERRED
// (recorded in WORKLOG: lazy per-language parser chunks; the budget rules
// out bundling them eagerly) — mermaid fences are handled by the separate
// mermaid handler/widget.

import { Decoration } from "@codemirror/view";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });
const codeLine = Decoration.line({ class: "cm-md-codeblock" });

export function fenceInfo(state, nodeRef) {
  const info = nodeRef.node.getChild("CodeInfo");
  return info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
}

function decorateFence(nodeRef, view, revealed) {
  const out = [];
  const rev = revealed(nodeRef.from, nodeRef.to);
  for (const m of nodeRef.node.getChildren("CodeMark")) {
    out.push({ from: m.from, to: m.to, deco: rev ? markerRevealed : marker });
  }
  const info = nodeRef.node.getChild("CodeInfo");
  if (info) {
    out.push({ from: info.from, to: info.to, deco: rev ? markerRevealed : marker });
  }
  const first = view.state.doc.lineAt(nodeRef.from).number;
  const last = view.state.doc.lineAt(nodeRef.to).number;
  for (let n = first; n <= last; n++) {
    const line = view.state.doc.line(n);
    // a height-NEUTRAL line decoration (background only) — `line: true` lets it
    // through the session's zero-width filter (it was being dropped before, so
    // code blocks rendered unstyled; owner 2026-06-19)
    out.push({ from: line.from, to: line.from, deco: codeLine, line: true });
  }
  return out;
}

export const codeFenceHandler = {
  id: "md.code-fence",
  nodes: ["FencedCode"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    if (fenceInfo(view.state, nodeRef) === "mermaid") return []; // mermaid handler owns it
    return decorateFence(nodeRef, view, revealed);
  },
};

// detached editors (the markdown.editing service, { mermaid: false }): no
// mermaid widget owns the fence there — the carve-out above exists only to
// hand the fence over — so ```mermaid decorates as plain code like any
// other language (owner directive 2026-06-12)
export const plainCodeFenceHandler = { ...codeFenceHandler, decorate: decorateFence };
