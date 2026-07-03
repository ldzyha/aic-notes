// bold + italic — marker reveal + no-shift styling (text-shadow, never
// font-weight) + selection-aware toggle commands.

import { Decoration } from "@codemirror/view";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });
const bold = Decoration.mark({ class: "cm-md-bold" });
const italic = Decoration.mark({ class: "cm-md-italic" });

function emphasis(nodeRef, revealed, contentDeco) {
  const out = [];
  const rev = revealed(nodeRef.from, nodeRef.to);
  const marks = nodeRef.node.getChildren("EmphasisMark");
  for (const m of marks) {
    out.push({ from: m.from, to: m.to, deco: rev ? markerRevealed : marker });
  }
  if (marks.length === 2 && marks[0].to < marks[1].from) {
    out.push({ from: marks[0].to, to: marks[1].from, deco: contentDeco });
  }
  return out;
}

export function toggleWrap(view, markerText) {
  let { from, to } = view.state.selection.main;
  // no selection: operate on the WORD under the cursor so Mod-b/Mod-i style
  // the current word instead of inserting an empty ** ** pair (owner
  // 2026-06-19: the toggle felt like it wrapped far more than intended)
  if (from === to) {
    const line = view.state.doc.lineAt(from);
    const text = line.text;
    let s = from - line.from;
    let e = s;
    // stop at whitespace, the marker chars themselves, and trailing punctuation
    // so a cursor inside `**foo**` expands to just `foo` (the before/after `**`
    // check then toggles it OFF cleanly) instead of swallowing the markers and
    // re-wrapping into `****foo****` (review 2026-06-19)
    const stop = (c) => !/\S/.test(c) || markerText.includes(c) || /[.,;:!?)\]]/.test(c);
    while (s > 0 && !stop(text[s - 1])) s -= 1;
    while (e < text.length && !stop(text[e])) e += 1;
    if (e > s) {
      from = line.from + s;
      to = line.from + e;
    }
  }
  const n = markerText.length;
  const before = view.state.sliceDoc(Math.max(0, from - n), from);
  const after = view.state.sliceDoc(to, Math.min(view.state.doc.length, to + n));
  if (before === markerText && after === markerText) {
    view.dispatch({
      changes: [
        { from: from - n, to: from },
        { from: to, to: to + n },
      ],
    });
  } else {
    view.dispatch({
      changes: [
        { from, insert: markerText },
        { from: to, insert: markerText },
      ],
      selection: { anchor: from + n, head: to + n },
    });
  }
  view.focus();
}

export const boldHandler = {
  id: "md.bold",
  nodes: ["StrongEmphasis"],
  priority: 50,
  decorate: (nodeRef, view, revealed) => emphasis(nodeRef, revealed, bold),
  commands: { "md.bold.toggle": (view) => toggleWrap(view, "**") },
};

export const italicHandler = {
  id: "md.italic",
  nodes: ["Emphasis"],
  priority: 50,
  decorate: (nodeRef, view, revealed) => emphasis(nodeRef, revealed, italic),
  commands: { "md.italic.toggle": (view) => toggleWrap(view, "*") },
};
