import { syntaxTree } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { createLinkControl } from "../aic-editor-core/structured-preview.js";

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function resolveLocal(url, host) {
  const clean = url.split("#")[0].split("?")[0].trim();
  if (clean.startsWith("/")) return clean.replace(/^\/+/, "");
  const base = host?.editor?.getActiveBuffer?.()?.path ?? "";
  const parts = base.includes("/") ? base.slice(0, base.lastIndexOf("/")).split("/") : [];
  for (const encodedSegment of clean.split("/")) {
    let segment = encodedSegment;
    try {
      segment = decodeURIComponent(encodedSegment);
    } catch {
      // Keep malformed input literal; the host performs the bounded stat.
    }
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

export function openLink(url, host) {
  const destination = url?.trim();
  if (!destination) return;
  if (EXTERNAL.test(destination) || /^[#?]/.test(destination) || !host) {
    host?.bus?.publish("link.external", { url: destination });
    return;
  }
  const path = resolveLocal(destination, host);
  if (path) host.bus.publish("file.open", { path, href: destination });
}

export function linkRecords(state) {
  const records = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "Link") {
        const url = node.node.getChild("URL");
        const marks = node.node.getChildren("LinkMark");
        if (!url || marks.length < 2) return;
        records.push({
          from: node.from,
          to: node.to,
          label: state.sliceDoc(marks[0].to, marks[1].from),
          url: state.sliceDoc(url.from, url.to),
          urlFrom: url.from,
          urlTo: url.to,
        });
        return false;
      }
      if (node.name === "Autolink") {
        const url = node.node.getChild("URL");
        if (!url) return;
        const value = state.sliceDoc(url.from, url.to);
        records.push({ from: node.from, to: node.to, label: value, url: value, urlFrom: url.from, urlTo: url.to });
        return false;
      }
      if (node.name === "URL" && !["Link", "Autolink"].includes(node.node.parent?.name)) {
        const value = state.sliceDoc(node.from, node.to);
        records.push({ from: node.from, to: node.to, label: value, url: value, urlFrom: node.from, urlTo: node.to });
      }
    },
  });
  return records;
}

class LinkWidget extends WidgetType {
  constructor(record, host, readOnly) {
    super();
    this.record = record;
    this.host = host;
    this.readOnly = readOnly;
  }

  eq(other) {
    return other.record.from === this.record.from && other.record.to === this.record.to &&
      other.record.label === this.record.label && other.record.url === this.record.url &&
      other.readOnly === this.readOnly;
  }

  toDOM(view) {
    return createLinkControl(view.dom.ownerDocument, {
      label: this.record.label,
      url: this.record.url,
      readOnly: this.readOnly,
      onOpen: () => openLink(this.record.url, this.host),
      onCopy: () => this.host?.bus?.publish("clipboard.write", { text: this.record.url, label: "link URL" }),
      onEdit: () => {
        view.dispatch({
          selection: { anchor: this.record.urlFrom, head: this.record.urlTo },
          scrollIntoView: true,
        });
        view.focus();
      },
    });
  }

  ignoreEvent() {
    return true;
  }
}

export function makeLinkActionsExtension(host) {
  function build(state) {
    const decorations = [];
    for (const record of linkRecords(state)) {
      const active = state.selection.ranges.some((range) => range.from <= record.to && range.to >= record.from);
      if (active) continue;
      decorations.push(
        Decoration.replace({ widget: new LinkWidget(record, host, state.readOnly) }).range(record.from, record.to),
      );
    }
    return Decoration.set(decorations, true);
  }

  return StateField.define({
    create: build,
    update(value, transaction) {
      if (!transaction.docChanged && !transaction.selection && transaction.startState.readOnly === transaction.state.readOnly) return value;
      return build(transaction.state);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
