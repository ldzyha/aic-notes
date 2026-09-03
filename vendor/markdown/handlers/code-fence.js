// code-fence — fence markers under the reveal rule, code body on a chip
// background. Nested syntax highlighting of fence languages is DEFERRED
// (recorded in WORKLOG: lazy per-language parser chunks; the budget rules
// out bundling them eagerly) — mermaid fences are handled by the separate
// mermaid handler/widget.

import { Decoration, EditorView, WidgetType, ViewPlugin } from "@codemirror/view";
import { StateEffect, StateField } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  selectionRevealsPreview,
} from "../../aic-editor-core/structured-preview.js";
import { createCodeFencePreview } from "../../aic-editor-core/code-fence-preview.js";

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

class CodeFenceWidget extends WidgetType {
  constructor(block, host, readOnly) {
    super();
    this.block = block;
    this.host = host;
    this.readOnly = readOnly;
  }

  eq(other) {
    return other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.language === this.block.language &&
      other.block.source === this.block.source &&
      other.readOnly === this.readOnly;
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    return createCodeFencePreview(document, {
      ...this.block,
      readOnly: this.readOnly,
      onCopy: () => {
        this.host.bus.publish("clipboard.write", {
          text: this.block.source,
          label: `${this.block.language || "code"} block`,
        });
        return true;
      },
      onEdit: () => {
        view.dispatch({ selection: { anchor: this.block.textFrom }, scrollIntoView: true });
        view.focus();
      },
    });
  }

  ignoreEvent() {
    return true;
  }
}

export function codeFences(state) {
  const blocks = [];
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  tree.iterate({
    enter(nodeRef) {
      if (nodeRef.name !== "FencedCode") return;
      const language = fenceInfo(state, nodeRef).split(/\s+/u)[0] || "";
      if (language === "mermaid") return;
      const text = nodeRef.node.getChild("CodeText");
      const afterOpen = Math.min(state.doc.lineAt(nodeRef.from).to + 1, nodeRef.to);
      blocks.push({
        from: nodeRef.from,
        to: nodeRef.to,
        textFrom: text ? text.from : afterOpen,
        source: text ? state.sliceDoc(text.from, text.to) : "",
        language,
      });
    },
  });
  return blocks;
}

const refreshCodeFences = StateEffect.define();

export function makeCodeFenceExtension(host) {
  function build(state) {
    const decorations = [];
    for (const block of codeFences(state)) {
      const inside =
        state.selection.ranges.some(
          (range) =>
            range.empty && range.from >= block.from && range.from <= block.to,
        ) ||
        selectionRevealsPreview(state.selection.ranges, block.from, block.to);
      if (!inside) {
        decorations.push(
          Decoration.replace({
            widget: new CodeFenceWidget(block, host, state.readOnly),
            block: true,
          }).range(block.from, block.to),
        );
      }
    }
    return Decoration.set(decorations, true);
  }

  const field = StateField.define({
    create: (state) => build(state),
    update(value, transaction) {
      if (transaction.docChanged || transaction.selection ||
          transaction.startState.readOnly !== transaction.state.readOnly ||
          transaction.effects.some((effect) => effect.is(refreshCodeFences))) {
        return build(transaction.state);
      }
      return value;
    },
    provide: (value) => EditorView.decorations.from(value),
  });

  const onScroll = ViewPlugin.fromClass(class {
    update(update) {
      if (update.viewportChanged && !update.docChanged && !update.selectionSet) {
        Promise.resolve().then(() => {
          try {
            update.view.dispatch({ effects: refreshCodeFences.of(null) });
          } catch {
            // The editor was disposed before the deferred refresh.
          }
        });
      }
    }
  });

  return [field, onScroll];
}
