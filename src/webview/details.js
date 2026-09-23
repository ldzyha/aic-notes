import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { openLink } from "../../vendor/markdown/link-actions.js";
import {
  createIconButton,
  selectionRevealsPreview,
  selectionStaysInSource,
} from "../../vendor/aic-editor-core/structured-preview.js";
import { providePreviewRanges } from "../../vendor/aic-editor-core/preview-ranges.js";
import {
  sourcePreviewExit,
  sourcePreviewExitHandlers,
} from "../../vendor/aic-editor-core/source-mode.js";
import { detailsForDocument, toggleDetailsMarker } from "./details-model.js";

const toggleVisual = StateEffect.define();
const editSource = StateEffect.define({
  map: (value, mapping) => mapping.mapPos(value),
});
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

const sourceOverrides = StateField.define({
  create: () => new Set(),
  update(value, transaction) {
    let next = transaction.docChanged
      ? new Set(
          [...value].map((position) => transaction.changes.mapPos(position)),
        )
      : value;
    for (const effect of transaction.effects) {
      if (!effect.is(editSource)) continue;
      if (next === value) next = new Set(next);
      next.add(effect.value);
    }
    if (transaction.effects.some((effect) => effect.is(sourcePreviewExit)))
      next = new Set();
    if (transaction.selection && next.size) {
      const blocks = detailsForDocument(transaction.state.doc);
      const selected = transaction.state.selection.ranges;
      next = new Set(
        [...next].filter((position) => {
          const block = blocks.find(
            ({ headerFrom }) => headerFrom === position,
          );
          return Boolean(
            block && selectionStaysInSource(selected, block.from, block.end),
          );
        }),
      );
    }
    return next;
  },
});

class DetailsSummaryWidget extends WidgetType {
  constructor(block, headerSource, open, host, readOnly, onCopy) {
    super();
    this.block = block;
    this.headerSource = headerSource;
    this.open = open;
    this.host = host;
    this.readOnly = readOnly;
    this.onCopy = onCopy;
  }

  eq(other) {
    return (
      other.headerSource === this.headerSource &&
      JSON.stringify(other.block) === JSON.stringify(this.block) &&
      other.open === this.open &&
      other.readOnly === this.readOnly &&
      other.onCopy === this.onCopy
    );
  }

  ignoreEvent() {
    // Summary controls own their pointer events. Letting CodeMirror process
    // the same mousedown can recreate the widget before its checkbox click
    // lands, which makes the task control appear inert.
    return true;
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const row = document.createElement("div");
    row.className = "cm-aic-details-summary";
    row.dataset.aicSourceFrom = String(this.block.from);
    row.dataset.aicSourceTo = String(this.block.end);
    row.dataset.open = String(this.open);
    row.dataset.body = String(this.block.contentFrom < this.block.closeFrom);
    const isCurrent = () =>
      row.isConnected &&
      this.block.headerFrom >= 0 &&
      this.block.headerTo >= this.block.headerFrom &&
      this.block.headerTo <= view.state.doc.length &&
      view.state.sliceDoc(this.block.headerFrom, this.block.headerTo) ===
        this.headerSource;

    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.className = "cm-aic-details-disclosure cm-aic-icon-button";
    disclosure.dataset.aicIcon = "chevron";
    disclosure.setAttribute(
      "aria-label",
      this.open ? "Collapse details" : "Expand details",
    );
    disclosure.setAttribute("aria-expanded", String(this.open));
    disclosure.onmousedown = (event) => event.preventDefault();
    const toggle = () => {
      if (!isCurrent()) return;
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
    disclosure.onclick = toggle;
    row.appendChild(disclosure);

    const data = this.block.summary;
    if (data.checked !== null) {
      const checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = `cm-aic-details-check${data.checked ? " checked" : ""}`;
      checkbox.setAttribute("role", "checkbox");
      checkbox.setAttribute("aria-checked", String(data.checked));
      checkbox.setAttribute(
        "aria-label",
        data.checked
          ? "Mark linked item incomplete"
          : "Mark linked item complete",
      );
      checkbox.disabled = view.state.readOnly;
      checkbox.onmousedown = (event) => event.preventDefault();
      checkbox.onclick = () => {
        if (view.state.readOnly || !isCurrent() || data.taskOffset < 0) return;
        const from = this.block.titleFrom + data.taskOffset;
        if (from < this.block.headerFrom || from + 1 > this.block.headerTo)
          return;
        view.dispatch({
          changes: { from, to: from + 1, insert: data.checked ? " " : "x" },
          userEvent: "input",
        });
      };
      row.appendChild(checkbox);
    }

    const title = document.createElement("button");
    title.type = "button";
    title.className = "cm-aic-details-title";
    title.textContent = data.label;
    title.setAttribute(
      "aria-label",
      `${this.open ? "Collapse" : "Expand"} ${data.label}`,
    );
    title.onmousedown = (event) => event.preventDefault();
    title.onclick = toggle;
    row.appendChild(title);

    if (data.href) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "cm-aic-details-link cm-aic-icon-button";
      link.dataset.aicIcon = "open";
      link.setAttribute("aria-label", `Open linked source: ${data.label}`);
      link.onmousedown = (event) => event.preventDefault();
      link.onclick = () => openLink(data.href, this.host);
      row.appendChild(link);
    }

    const edit = createIconButton(document, {
      label: view.state.readOnly
        ? "View details source"
        : "Edit details source",
      icon: view.state.readOnly ? "source" : "edit",
      className: "cm-md-edit-source cm-aic-details-edit",
      onActivate: () => {
        if (!isCurrent()) return;
        const anchor = Math.min(this.block.headerTo, this.block.headerFrom + 4);
        view.dispatch({
          selection: { anchor },
          effects: editSource.of(this.block.headerFrom),
          scrollIntoView: true,
        });
        view.focus();
      },
    });
    row.appendChild(edit);
    if (!this.readOnly) {
      const cut = createIconButton(document, {
        label: "Cut details block",
        icon: "cut",
        className: "cm-md-edit-source cm-aic-details-cut",
        onActivate: async () => {
          if (view.state.readOnly || !isCurrent()) return;
          const source = view.state.sliceDoc(this.block.from, this.block.end);
          let copied = false;
          try {
            if (this.onCopy) copied = (await this.onCopy(source)) !== false;
            else {
              this.host.bus.publish("clipboard.write", {
                text: source,
                label: "Details block",
              });
              copied = true;
            }
          } catch {
            copied = false;
          }
          if (
            !copied ||
            view.state.readOnly ||
            !isCurrent() ||
            view.state.sliceDoc(this.block.from, this.block.end) !== source
          )
            return;
          view.dispatch({
            changes: { from: this.block.from, to: this.block.end },
            userEvent: "input.cut",
          });
          view.focus();
        },
      });
      row.appendChild(cut);
    }
    return row;
  }
}

function previewDecorations(state, host, onCopy) {
  const overrides = state.field(visualOverrides);
  const source = state.field(sourceOverrides);
  const ranges = [];
  for (const block of detailsForDocument(state.doc)) {
    if (
      source.has(block.headerFrom) ||
      selectionRevealsPreview(state.selection.ranges, block.from, block.end)
    )
      continue;
    const open = overrides.has(block.headerFrom) ? !block.open : block.open;
    const widget = new DetailsSummaryWidget(
      block,
      state.sliceDoc(block.headerFrom, block.headerTo),
      open,
      host,
      state.readOnly,
      onCopy,
    );
    if (!open) {
      ranges.push(
        Decoration.replace({ block: true, widget }).range(
          block.from,
          block.end,
        ),
      );
      continue;
    }
    ranges.push(
      Decoration.replace({ block: true, widget }).range(
        block.headerFrom,
        block.headerTo,
      ),
    );
    ranges.push(
      Decoration.replace({ block: true }).range(block.closeFrom, block.closeTo),
    );
  }
  return Decoration.set(ranges, true);
}

function previewStateChanged(transaction) {
  return (
    transaction.docChanged ||
    Boolean(transaction.selection) ||
    transaction.startState.readOnly !== transaction.state.readOnly ||
    transaction.effects.some(
      (effect) =>
        effect.is(toggleVisual) ||
        effect.is(editSource) ||
        effect.is(sourcePreviewExit),
    )
  );
}

function detailsDecorations(host, onCopy) {
  return StateField.define({
    create(state) {
      return previewDecorations(state, host, onCopy);
    },
    update(value, transaction) {
      return previewStateChanged(transaction)
        ? previewDecorations(transaction.state, host, onCopy)
        : value;
    },
    provide: providePreviewRanges,
  });
}

const bodyDecorations = StateField.define({
  create(state) {
    return buildBodyDecorations(state);
  },
  update(value, transaction) {
    return previewStateChanged(transaction)
      ? buildBodyDecorations(transaction.state)
      : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildBodyDecorations(state) {
  const overrides = state.field(visualOverrides);
  const source = state.field(sourceOverrides);
  const ranges = [];
  for (const block of detailsForDocument(state.doc)) {
    if (
      source.has(block.headerFrom) ||
      selectionRevealsPreview(state.selection.ranges, block.from, block.end)
    )
      continue;
    const open = overrides.has(block.headerFrom) ? !block.open : block.open;
    if (!open) continue;
    const first = state.doc.lineAt(block.contentFrom).number;
    const bodyLines = [];
    for (let number = first; number <= state.doc.lines; number++) {
      const line = state.doc.line(number);
      if (line.from >= block.closeFrom) break;
      bodyLines.push(line);
    }
    bodyLines.forEach((line, index) => {
      const classes = ["cm-aic-details-body"];
      if (index === 0) classes.push("cm-aic-details-body-first");
      if (index === bodyLines.length - 1)
        classes.push("cm-aic-details-body-last");
      ranges.push(
        Decoration.line({ attributes: { class: classes.join(" ") } }).range(
          line.from,
        ),
      );
    });
  }
  return Decoration.set(ranges, true);
}

export function detailsExtension(host, { onCopy } = {}) {
  return [
    visualOverrides,
    sourceOverrides,
    sourcePreviewExitHandlers.of((state) => {
      const active = state.field(sourceOverrides);
      return (
        detailsForDocument(state.doc).find((block) =>
          active.has(block.headerFrom),
        ) ?? null
      );
    }),
    bodyDecorations,
    detailsDecorations(host, onCopy),
  ];
}
