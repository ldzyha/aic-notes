// Raw-source link styling while the link action widget is in edit mode.
// The compact open/copy/edit control is owned by link-actions.js.

import { Decoration } from "@codemirror/view";

const marker = Decoration.mark({ class: "cm-md-marker" });
const markerRevealed = Decoration.mark({ class: "cm-md-marker cm-md-marker-revealed" });
// in-project path vs external (scheme-bearing) link text — colored apart,
// underline shared (owner 2026-06-16: links must distinguish local vs external)
const linkLocal = Decoration.mark({ class: "cm-md-link cm-md-link-local" });
const linkExternal = Decoration.mark({ class: "cm-md-link cm-md-link-external" });
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|tel:)/i;

export const linkHandler = {
  id: "md.link",
  nodes: ["Link"],
  priority: 50,
  decorate(nodeRef, view, revealed) {
    const out = [];
    const rev = revealed(nodeRef.from, nodeRef.to);
    const node = nodeRef.node;
    const marks = node.getChildren("LinkMark"); // [ ] ( )
    const url = node.getChild("URL");
    for (const m of marks) {
      out.push({ from: m.from, to: m.to, deco: rev ? markerRevealed : marker });
    }
    if (url) {
      out.push({ from: url.from, to: url.to, deco: rev ? markerRevealed : marker });
    }
    if (marks.length >= 2 && marks[0].to < marks[1].from) {
      const dest = url ? view.state.sliceDoc(url.from, url.to).trim() : "";
      const deco = EXTERNAL.test(dest) ? linkExternal : linkLocal;
      out.push({ from: marks[0].to, to: marks[1].from, deco });
    }
    return out;
  },
  commands: {
    "md.link.insert": (view) => {
      const { from, to } = view.state.selection.main;
      const selection = view.state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: `[${selection}]()` },
        selection: { anchor: from + selection.length + 3 }, // inside ()
      });
      view.focus();
    },
  },
};
