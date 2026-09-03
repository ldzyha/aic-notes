// code-fence — fence markers under the reveal rule, code body on a chip
// background. Nested syntax highlighting of fence languages is DEFERRED
// (recorded in WORKLOG: lazy per-language parser chunks; the budget rules
// out bundling them eagerly) — mermaid fences are handled by the separate
// mermaid handler/widget.

import { Decoration } from "@codemirror/view";
import { fenceInfo } from "../../aic-editor-core/code-fence-extension.js";

export {
  codeFences,
  makeCodeFenceExtension,
} from "../../aic-editor-core/code-fence-extension.js";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({
  class: "cm-md-marker cm-md-marker-revealed",
});
const codeLine = Decoration.line({ class: "cm-md-codeblock" });

function decorateFence(nodeRef, view, revealed) {
  const out = [];
  const rev = revealed(nodeRef.from, nodeRef.to);
  for (const mark of nodeRef.node.getChildren("CodeMark")) {
    out.push({
      from: mark.from,
      to: mark.to,
      deco: rev ? markerRevealed : marker,
    });
  }
  const info = nodeRef.node.getChild("CodeInfo");
  if (info) {
    out.push({
      from: info.from,
      to: info.to,
      deco: rev ? markerRevealed : marker,
    });
  }
  const first = view.state.doc.lineAt(nodeRef.from).number;
  const last = view.state.doc.lineAt(nodeRef.to).number;
  for (let number = first; number <= last; number++) {
    const line = view.state.doc.line(number);
    out.push({
      from: line.from,
      to: line.from,
      deco: codeLine,
      line: true,
    });
  }
  return out;
}

export const codeFenceHandler = {
  id: "md.code-fence",
  nodes: ["FencedCode"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    if (fenceInfo(view.state, nodeRef) === "mermaid") return [];
    return decorateFence(nodeRef, view, revealed);
  },
};

// Detached source editors have no Mermaid widget to own the fence, so Mermaid
// stays readable as ordinary fenced code there.
export const plainCodeFenceHandler = {
  ...codeFenceHandler,
  decorate: decorateFence,
};
