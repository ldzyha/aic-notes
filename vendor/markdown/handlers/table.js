import { syntaxTree } from "@codemirror/language";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
  addTableColumn,
  addTableRow,
  createIconButton,
  moveTableColumn,
  moveTableRow,
  selectionRevealsPreview,
  serializeTable,
  showIconFeedback,
  updateTableCell,
} from "../../aic-editor-core/structured-preview.js";

const editSource = StateEffect.define({
  map: (value, mapping) => ({ ...value, from: mapping.mapPos(value.from) }),
});

function selectionIntersects(state, from, to) {
  return state.selection.ranges.some((range) =>
    range.empty
      ? range.from >= from && range.from < to
      : range.from < to && range.to > from,
  );
}

function splitRow(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

export function parseTable(source) {
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delimiters = splitRow(lines[1]);
  if (
    !header.length ||
    delimiters.length !== header.length ||
    delimiters.some((value) => !/^:?-{3,}:?$/.test(value))
  ) {
    return null;
  }
  const aligns = delimiters.map((value) => {
    const left = value.startsWith(":");
    const right = value.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : "";
  });
  return { header, aligns, rows: lines.slice(2).map(splitRow) };
}

function action(document, label, icon, run, disabled = false) {
  return createIconButton(document, {
    label,
    icon,
    className: "cm-md-edit-source",
    disabled,
    onActivate: run,
  });
}

function previewHeader(document, label, actions) {
  const header = document.createElement("div");
  header.className = "cm-md-preview-header";
  const title = document.createElement("span");
  title.textContent = label;
  const group = document.createElement("span");
  group.className = "cm-md-preview-actions";
  group.append(...actions);
  header.append(title, group);
  return header;
}

function input(document, value, label, onChange, readOnly) {
  const field = document.createElement("textarea");
  field.rows = 1;
  field.className = "cm-aic-structure-input";
  field.value = value;
  field.setAttribute("aria-label", label);
  field.readOnly = readOnly;
  const fit = () => {
    field.style.height = "0";
    field.style.height = `${Math.max(30, field.scrollHeight)}px`;
  };
  field.addEventListener("input", fit);
  field.addEventListener("change", () => onChange(field.value));
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      field.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      field.value = value;
      field.blur();
    }
  });
  queueMicrotask(fit);
  return field;
}

function dragHandle(document, label, kind, index, readOnly) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "cm-aic-drag-handle cm-aic-icon-button";
  handle.dataset.aicIcon = "drag";
  handle.setAttribute("aria-label", label);
  handle.draggable = !readOnly;
  handle.disabled = readOnly;
  handle.addEventListener("pointerdown", (event) => event.stopPropagation());
  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData(`application/x-aic-${kind}`, String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  return handle;
}

function dropTarget(element, kind, index, onMove, readOnly) {
  if (readOnly) return;
  element.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types.includes(`application/x-aic-${kind}`))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  element.addEventListener("drop", (event) => {
    const value =
      event.dataTransfer?.getData(`application/x-aic-${kind}`) ?? "";
    const from = Number(value);
    if (!Number.isInteger(from)) return;
    event.preventDefault();
    onMove(from, index);
  });
}

class TableWidget extends WidgetType {
  constructor(source, from, readOnly, host) {
    super();
    this.source = source;
    this.from = from;
    this.readOnly = readOnly;
    this.host = host;
  }

  eq(other) {
    return (
      other.source === this.source &&
      other.from === this.from &&
      other.readOnly === this.readOnly
    );
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table cm-md-block-preview";
    wrapper.dataset.aicSourceFrom = String(this.from);
    wrapper.dataset.aicSourceTo = String(this.from + this.source.length);
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Interactive Markdown table");
    const parsed = parseTable(this.source);
    const replace = (model) => {
      const lineEnding = this.source.includes("\r\n") ? "\r\n" : "\n";
      const markdown = serializeTable(model, lineEnding);
      if (!markdown || markdown === this.source) return;
      view.dispatch({
        changes: {
          from: this.from,
          to: this.from + this.source.length,
          insert: markdown,
        },
        userEvent: "input",
      });
    };
    const reveal = () => {
      view.dispatch({
        selection: { anchor: this.from },
        effects: editSource.of({ from: this.from }),
        scrollIntoView: true,
      });
      view.focus();
    };
    const copy = (button) => {
      this.host?.bus?.publish("clipboard.write", {
        text: this.source,
        label: "Markdown table",
      });
      showIconFeedback(button, { restoreLabel: "Copy table" });
    };
    if (!parsed) {
      const fallback = document.createElement("pre");
      fallback.textContent = this.source;
      wrapper.append(
        previewHeader(document, "Table", [
          action(document, "Copy table", "copy", copy),
          action(document, "Edit table source", "edit", reveal),
        ]),
        fallback,
      );
      return wrapper;
    }
    wrapper.append(
      previewHeader(document, "Table", [
        action(
          document,
          "Add row",
          "add-row",
          () => replace(addTableRow(parsed)),
          this.readOnly,
        ),
        action(
          document,
          "Add column",
          "add-column",
          () => replace(addTableColumn(parsed)),
          this.readOnly,
        ),
        action(document, "Copy table", "copy", copy),
        action(
          document,
          this.readOnly ? "View table source" : "Edit table source",
          this.readOnly ? "source" : "edit",
          reveal,
        ),
      ]),
    );
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    const headHandle = document.createElement("th");
    headHandle.className = "cm-aic-structure-handle-cell";
    headRow.append(headHandle);
    parsed.header.forEach((value, columnIndex) => {
      const cell = document.createElement("th");
      const content = document.createElement("span");
      content.className = "cm-aic-structure-cell";
      content.append(
        dragHandle(
          document,
          `Move column ${value || columnIndex + 1}`,
          "column",
          columnIndex,
          this.readOnly,
        ),
        input(
          document,
          value,
          `Column ${columnIndex + 1} name`,
          (next) => replace(updateTableCell(parsed, -1, columnIndex, next)),
          this.readOnly,
        ),
      );
      cell.append(content);
      if (parsed.aligns[columnIndex])
        cell.style.textAlign = parsed.aligns[columnIndex];
      dropTarget(
        cell,
        "column",
        columnIndex,
        (from, to) => replace(moveTableColumn(parsed, from, to)),
        this.readOnly,
      );
      headRow.append(cell);
    });
    head.append(headRow);
    table.append(head);
    const body = document.createElement("tbody");
    parsed.rows.forEach((row, rowIndex) => {
      const rowElement = document.createElement("tr");
      const handleCell = document.createElement("td");
      handleCell.className = "cm-aic-structure-handle-cell";
      handleCell.append(
        dragHandle(
          document,
          `Move row ${rowIndex + 1}`,
          "row",
          rowIndex,
          this.readOnly,
        ),
      );
      rowElement.append(handleCell);
      parsed.header.forEach((_, columnIndex) => {
        const cell = document.createElement("td");
        cell.append(
          input(
            document,
            row[columnIndex] ?? "",
            `Row ${rowIndex + 1}, column ${columnIndex + 1}`,
            (next) =>
              replace(updateTableCell(parsed, rowIndex, columnIndex, next)),
            this.readOnly,
          ),
        );
        if (parsed.aligns[columnIndex])
          cell.style.textAlign = parsed.aligns[columnIndex];
        rowElement.append(cell);
      });
      dropTarget(
        rowElement,
        "row",
        rowIndex,
        (from, to) => replace(moveTableRow(parsed, from, to)),
        this.readOnly,
      );
      body.append(rowElement);
    });
    table.append(body);
    const scroll = document.createElement("div");
    scroll.className = "cm-aic-table-scroll";
    scroll.append(table);
    wrapper.append(scroll);
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

export function tableNodes(state) {
  const nodes = [];
  try {
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === "Table") nodes.push({ from: node.from, to: node.to });
      },
    });
  } catch {
    // Half-parsed source is left raw until the next transaction.
  }
  return nodes;
}

export function makeTableExtension(host) {
  const sourceOverrides = StateField.define({
    create: () => null,
    update(value, transaction) {
      let next = value
        ? { ...value, from: transaction.changes.mapPos(value.from) }
        : null;
      for (const effect of transaction.effects) {
        if (effect.is(editSource)) next = effect.value;
      }
      if (!next) return null;
      const node = tableNodes(transaction.state).find(
        ({ from }) => from === next.from,
      );
      return node && selectionIntersects(transaction.state, node.from, node.to)
        ? next
        : null;
    },
  });
  const build = (state) => {
    const decorations = [];
    const source = state.field(sourceOverrides);
    for (const node of tableNodes(state)) {
      const markdown = state.sliceDoc(node.from, node.to);
      if (
        source?.from !== node.from &&
        !selectionRevealsPreview(state.selection.ranges, node.from, node.to) &&
        markdown.trim() &&
        parseTable(markdown)
      ) {
        decorations.push(
          Decoration.replace({
            widget: new TableWidget(markdown, node.from, state.readOnly, host),
            block: true,
          }).range(node.from, node.to),
        );
      }
    }
    return Decoration.set(decorations, true);
  };
  return [
    sourceOverrides,
    StateField.define({
      create: build,
      update(value, transaction) {
        if (
          !transaction.docChanged &&
          !transaction.selection &&
          transaction.startState.readOnly === transaction.state.readOnly
        )
          return value;
        return build(transaction.state);
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
  ];
}
