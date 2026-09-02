import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import {
  addProperty,
  createCellEditor,
  createIconButton,
  formatPropertyValue,
  moveProperty,
  parseFrontmatterRows,
  selectionRevealsPreview,
  serializeFrontmatter,
  updateProperty,
  validPropertyKey,
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

export function parseFrontmatter(document) {
  if (!document.startsWith("---")) return null;
  const lines = document.split("\n");
  if (lines[0].replace(/\r$/, "").trim() !== "---") return null;
  let to = lines[0].length;
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].replace(/\r$/, "");
    if (line.trim() === "---") {
      to += 1 + lines[index].length;
      const rows = parseFrontmatterRows(lines.slice(1, index).join("\n"));
      return rows?.length ? { rows, from: 0, to } : null;
    }
    to += 1 + lines[index].length;
  }
  return null;
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

function dragHandle(document, index, readOnly) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "cm-aic-drag-handle cm-aic-icon-button";
  handle.dataset.aicIcon = "drag";
  handle.setAttribute("aria-label", `Move property ${index + 1}`);
  handle.draggable = !readOnly;
  handle.disabled = readOnly;
  handle.addEventListener("dragstart", (event) => {
    event.dataTransfer?.setData("application/x-aic-property", String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  });
  return handle;
}

export const setNoteRelationships = StateEffect.define();

function relationshipTree(document, relationships, host) {
  if (!relationships.length) return null;
  const region = document.createElement("section");
  region.className = "cm-aic-note-relations";
  region.setAttribute("aria-label", "Related notes");
  const heading = document.createElement("div");
  heading.className = "cm-aic-note-relations-heading";
  heading.textContent = "Context";
  const tree = document.createElement("ul");
  tree.setAttribute("role", "tree");
  for (const item of relationships) {
    const row = document.createElement("li");
    row.setAttribute("role", "treeitem");
    row.setAttribute(
      "aria-current",
      item.relation === "current" ? "true" : "false",
    );
    row.style.setProperty(
      "--aic-note-depth",
      String(Math.max(0, Math.min(8, Number(item.depth) || 0))),
    );
    const open = document.createElement("button");
    open.type = "button";
    open.className = "cm-aic-note-relation-open";
    open.setAttribute("aria-label", `Open ${item.relation} note ${item.label}`);
    open.onmousedown = (event) => event.preventDefault();
    open.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      host.bus.publish("note.open", { path: item.path });
    };
    const marker = document.createElement("span");
    marker.className = "cm-aic-note-relation-marker";
    marker.textContent = item.exists ? "●" : "○";
    const label = document.createElement("span");
    label.className = "cm-aic-note-relation-label";
    label.textContent = item.label;
    const relation = document.createElement("span");
    relation.className = "cm-aic-note-relation-kind";
    relation.textContent = item.relation;
    open.append(marker, label, relation);
    row.append(open);
    tree.append(row);
  }
  region.append(heading, tree);
  return region;
}

class FrontmatterWidget extends WidgetType {
  constructor(block, readOnly, relationships, host) {
    super();
    this.block = block;
    this.readOnly = readOnly;
    this.relationships = relationships;
    this.host = host;
  }

  eq(other) {
    return (
      other.readOnly === this.readOnly &&
      JSON.stringify(other.block.rows) === JSON.stringify(this.block.rows) &&
      JSON.stringify(other.relationships) === JSON.stringify(this.relationships)
    );
  }

  toDOM(view) {
    const document = view.dom.ownerDocument;
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-props cm-md-block-preview";
    wrapper.dataset.aicSourceFrom = String(this.block.from);
    wrapper.dataset.aicSourceTo = String(this.block.to);
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", "Interactive Markdown properties");
    const replace = (rows) => {
      const source = view.state.sliceDoc(this.block.from, this.block.to);
      const markdown = serializeFrontmatter(
        rows,
        source.includes("\r\n") ? "\r\n" : "\n",
      );
      if (!markdown || markdown === source) return;
      view.dispatch({
        changes: { from: this.block.from, to: this.block.to, insert: markdown },
        userEvent: "input",
      });
    };
    const reveal = () => {
      const anchor = Math.min(view.state.doc.length, this.block.from + 4);
      view.dispatch({
        selection: { anchor },
        effects: editSource.of({ from: this.block.from }),
        scrollIntoView: true,
      });
      view.focus();
    };
    const header = document.createElement("div");
    header.className = "cm-md-preview-header";
    const title = document.createElement("span");
    title.textContent = "Properties";
    const actions = document.createElement("span");
    actions.className = "cm-md-preview-actions";
    actions.append(
      action(
        document,
        "Add property",
        "add-property",
        () => replace(addProperty(this.block.rows)),
        this.readOnly,
      ),
      action(
        document,
        this.readOnly ? "View properties source" : "Edit properties source",
        this.readOnly ? "source" : "edit",
        reveal,
      ),
    );
    header.append(title, actions);
    wrapper.append(header);
    const table = document.createElement("table");
    const body = document.createElement("tbody");
    this.block.rows.forEach((item, index) => {
      const row = document.createElement("tr");
      row.dataset.depth = String(item.depth ?? 0);
      row.dataset.sequence = String(Boolean(item.sequence));
      const handle = document.createElement("th");
      handle.className = "cm-aic-structure-handle-cell";
      handle.append(dragHandle(document, index, this.readOnly));
      const key = document.createElement("th");
      key.className = "cm-aic-property-key-cell";
      const keyContent = document.createElement("div");
      keyContent.className = "cm-aic-property-key";
      keyContent.style.setProperty(
        "--aic-property-depth",
        String(Math.max(0, Math.min(12, item.depth ?? 0))),
      );
      const marker = document.createElement("span");
      marker.className = "cm-aic-property-level";
      marker.textContent = item.sequence ? "•" : item.depth ? "↳" : "";
      keyContent.append(marker);
      if (item.scalar) {
        const itemLabel = document.createElement("span");
        itemLabel.className = "cm-aic-property-item";
        itemLabel.textContent = "item";
        keyContent.append(itemLabel);
      } else {
        keyContent.append(
          createCellEditor(document, {
            value: item.key,
            label: `Property ${index + 1} name`,
            readOnly: this.readOnly,
            validate: (value) =>
              validPropertyKey(value.trim())
                ? ""
                : "Use letters, numbers, dot, underscore, or dash",
            onCommit: (value) =>
              replace(updateProperty(this.block.rows, index, "key", value)),
          }),
        );
      }
      key.append(keyContent);
      const value = document.createElement("td");
      const hasChildren =
        !item.value &&
        index + 1 < this.block.rows.length &&
        (this.block.rows[index + 1].indent ?? 0) > (item.indent ?? 0);
      if (hasChildren) {
        const group = document.createElement("span");
        group.className = "cm-aic-property-group";
        group.textContent = "Group";
        value.append(group);
      } else {
        value.append(
          createCellEditor(document, {
            value: item.value,
            displayValue: formatPropertyValue(item.key, item.value),
            label: `Property ${item.key || "list item"} value`,
            multiline: true,
            readOnly: this.readOnly,
            onCommit: (next) =>
              replace(updateProperty(this.block.rows, index, "value", next)),
          }),
        );
      }
      if (!this.readOnly) {
        row.addEventListener("dragover", (event) => {
          if (!event.dataTransfer?.types.includes("application/x-aic-property"))
            return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        });
        row.addEventListener("drop", (event) => {
          const from = Number(
            event.dataTransfer?.getData("application/x-aic-property"),
          );
          if (!Number.isInteger(from)) return;
          event.preventDefault();
          replace(moveProperty(this.block.rows, from, index));
        });
      }
      row.append(handle, key, value);
      body.append(row);
    });
    table.append(body);
    wrapper.append(table);
    const relationships = relationshipTree(
      document,
      this.relationships,
      this.host,
    );
    if (relationships) wrapper.append(relationships);
    return wrapper;
  }

  ignoreEvent() {
    return true;
  }
}

export function makeFrontmatterExtension(
  host,
  initialRelationships = () => [],
) {
  const relationshipState = StateField.define({
    create: () => initialRelationships(),
    update(value, transaction) {
      for (const effect of transaction.effects) {
        if (effect.is(setNoteRelationships))
          return Array.isArray(effect.value) ? effect.value : [];
      }
      return value;
    },
  });
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
      const block = parseFrontmatter(transaction.state.doc.toString());
      return block?.from === next.from &&
        selectionIntersects(transaction.state, block.from, block.to)
        ? next
        : null;
    },
  });
  const build = (state) => {
    const block = parseFrontmatter(state.doc.toString());
    if (
      !block ||
      state.field(sourceOverrides)?.from === block.from ||
      selectionRevealsPreview(state.selection.ranges, block.from, block.to)
    )
      return Decoration.none;
    return Decoration.set(
      [
        Decoration.replace({
          widget: new FrontmatterWidget(
            block,
            state.readOnly,
            state.field(relationshipState),
            host,
          ),
          block: true,
        }).range(block.from, block.to),
      ],
      true,
    );
  };
  return [
    relationshipState,
    sourceOverrides,
    StateField.define({
      create: build,
      update(value, transaction) {
        const relationshipsChanged = transaction.effects.some((effect) =>
          effect.is(setNoteRelationships),
        );
        if (
          !transaction.docChanged &&
          !transaction.selection &&
          !relationshipsChanged &&
          transaction.startState.readOnly === transaction.state.readOnly
        )
          return value;
        return build(transaction.state);
      },
      provide: (field) => EditorView.decorations.from(field),
    }),
  ];
}
