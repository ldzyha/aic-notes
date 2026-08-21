import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { openLink } from "../../vendor/markdown/link-tooltip.js";
import { parseDetailsBlocks, toggleDetailsMarker } from "./details-model.js";

const toggleVisual = StateEffect.define();
const visualOverrides = StateField.define({
  create: () => new Set(),
  update(value, transaction) {
    if (transaction.docChanged) return new Set();
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(toggleVisual)) continue;
      next = new Set(next);
      if (next.has(effect.value)) next.delete(effect.value);
      else next.add(effect.value);
    }
    return next;
  },
});

class DetailsSummaryWidget extends WidgetType {
  constructor(block, open, host, readOnly) {
    super();
    this.block = block;
    this.open = open;
    this.host = host;
    this.readOnly = readOnly;
  }

  eq(other) {
    return other.block.headerFrom === this.block.headerFrom &&
      other.block.title === this.block.title &&
      other.open === this.open &&
      other.readOnly === this.readOnly;
  }

  ignoreEvent() {
    return false;
  }

  toDOM(view) {
    const row = document.createElement("div");
    row.className = "cm-aic-details-summary";
    row.dataset.open = String(this.open);

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "cm-aic-details-disclosure";
    disclosure.setAttribute("aria-label", this.open ? "Collapse details" : "Expand details");
    disclosure.setAttribute("aria-expanded", String(this.open));
    disclosure.textContent = this.open ? "▾" : "▸";
    disclosure.onmousedown = (event) => event.preventDefault();
    disclosure.onclick = () => {
      if (view.state.readOnly) {
        view.dispatch({ effects: toggleVisual.of(this.block.headerFrom) });
        return;
      }
      const line = view.state.doc.lineAt(this.block.headerFrom);
      const replacement = toggleDetailsMarker(line.text);
      if (!replacement) return;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: replacement },
        userEvent: "input",
      });
    };
    row.appendChild(disclosure);

    const data = this.block.summary;
    if (data.checked !== null) {
      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = `cm-aic-details-check${data.checked ? " checked" : ""}`;
      checkbox.setAttribute("role", "checkbox");
      checkbox.setAttribute("aria-checked", String(data.checked));
      checkbox.setAttribute("aria-label", data.checked ? "Mark linked item incomplete" : "Mark linked item complete");
      checkbox.disabled = view.state.readOnly;
      checkbox.onmousedown = (event) => event.preventDefault();
      checkbox.onclick = () => {
        if (view.state.readOnly || data.taskOffset < 0) return;
        const from = this.block.titleFrom + data.taskOffset;
        view.dispatch({
          changes: { from, to: from + 1, insert: data.checked ? " " : "x" },
          userEvent: "input",
        });
      };
      row.appendChild(checkbox);
    }

    if (data.href) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "cm-aic-details-link";
      link.textContent = data.label;
      link.title = data.href;
      link.onmousedown = (event) => event.preventDefault();
      link.onclick = () => openLink(data.href, this.host);
      row.appendChild(link);
    } else {
      const title = document.createElement("span");
      title.className = "cm-aic-details-title";
      title.textContent = data.label;
      row.appendChild(title);
    }
    return row;
  }
}

function decorations(state, host) {
  const overrides = state.field(visualOverrides);
  const ranges = [];
  for (const block of parseDetailsBlocks(state.doc.toString())) {
    const open = overrides.has(block.headerFrom) ? !block.open : block.open;
    const widget = new DetailsSummaryWidget(block, open, host, state.readOnly);
    if (!open) {
      ranges.push(Decoration.replace({ block: true, widget }).range(block.from, block.end));
      continue;
    }
    ranges.push(Decoration.replace({ block: true, widget }).range(block.headerFrom, block.contentFrom));
    ranges.push(Decoration.replace({ block: true }).range(block.closeFrom, block.closeTo));
  }
  return Decoration.set(ranges, true);
}

function detailsDecorations(host) {
  return StateField.define({
    create(state) {
      return decorations(state, host);
    },
    update(value, transaction) {
      return transaction.docChanged || transaction.effects.length
        ? decorations(transaction.state, host)
        : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export function detailsExtension(host) {
  return [visualOverrides, detailsDecorations(host)];
}
