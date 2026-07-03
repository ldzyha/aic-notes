// ADAPTED from aic modules/markdown/web/src/session.js — HANDLERS and
// decorationPlugin only; the MarkdownSession class (aic's buffer-session
// wiring: host store, mermaid float preview, fenced service resolver) is not
// vendored. See PROVENANCE.md.
//
// decorationPlugin owns the single reveal rule and its perf contract
// (pinned): inline decorations are computed over view.visibleRanges ONLY,
// recomputed on selectionSet/docChanged/viewportChanged. Handlers never
// implement reveal logic and never reference each other.

import { Decoration, ViewPlugin } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { headingHandler } from "./handlers/heading.js";
import { boldHandler, italicHandler } from "./handlers/emphasis.js";
import { inlineCodeHandler } from "./handlers/inline-code.js";
import { listHandler } from "./handlers/list.js";
import { linkHandler } from "./handlers/link.js";
import { blockquoteHandler, hrHandler, strikethroughHandler } from "./handlers/blocks.js";
import { codeFenceHandler } from "./handlers/code-fence.js";

export const HANDLERS = [
  headingHandler, boldHandler, italicHandler, inlineCodeHandler, listHandler,
  linkHandler, blockquoteHandler, hrHandler, strikethroughHandler, codeFenceHandler,
];

export function decorationPlugin(
  handlers,
  stats = { processedFrom: Infinity, processedTo: -Infinity, visibleFrom: 0, visibleTo: 0 },
) {
  const byNode = new Map();
  for (const handler of handlers) {
    for (const node of handler.nodes) byNode.set(node, handler);
  }

  function compute(view) {
    const { state } = view;
    // the single reveal rule (inclusive intersection, per selection range)
    const revealed = (from, to) =>
      state.selection.ranges.some((r) => r.from <= to && r.to >= from);
    const ranges = [];
    stats.processedFrom = Infinity;
    stats.processedTo = -Infinity;
    stats.visibleFrom = view.visibleRanges[0]?.from ?? 0;
    stats.visibleTo = view.visibleRanges.at(-1)?.to ?? 0;
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(state).iterate({
        from,
        to,
        enter(nodeRef) {
          const handler = byNode.get(nodeRef.name);
          if (!handler) return;
          stats.processedFrom = Math.min(stats.processedFrom, nodeRef.from);
          stats.processedTo = Math.max(stats.processedTo, nodeRef.to);
          for (const r of handler.decorate(nodeRef, view, revealed)) {
            // line/point decorations (code-block & heading lines) are
            // zero-width BY DESIGN — let them through (`r.line`); only empty
            // MARK ranges are dropped
            if (r.from < r.to) ranges.push(r.deco.range(r.from, r.to));
            else if (r.line) ranges.push(r.deco.range(r.from));
          }
        },
      });
    }
    return Decoration.set(ranges, true);
  }

  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = compute(view);
      }
      update(update) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = compute(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
