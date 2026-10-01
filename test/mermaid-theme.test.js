import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import { history, undoDepth } from "@codemirror/commands";
import { markdownLanguage } from "../vendor/markdown/language.js";
import { makeMermaidExtension } from "../vendor/markdown/mermaid.js";

function fixture(t, { editing = false } = {}) {
  const classes = new Set(["vscode-light"]);
  const observers = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target, options) {
      this.target = target;
      this.options = options;
    }
    disconnect() {
      this.disconnected = true;
    }
  }
  const document = {
    body: { classList: { contains: (value) => classes.has(value) } },
    defaultView: { MutationObserver: Observer },
  };
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: document,
  });
  t.after(() => {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
  });
  const source = "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter";
  const extension = makeMermaidExtension({
    bus: {
      publish() {
        assert.fail("Theme changes must not publish a host mutation");
      },
    },
  });
  const view = {
    dom: { ownerDocument: document },
    state: EditorState.create({
      doc: source,
      selection: { anchor: editing ? source.indexOf("A -->") : source.length },
      extensions: [markdownLanguage, history(), extension],
    }),
    transactions: [],
    dispatch(spec) {
      const transaction = this.state.update(spec);
      this.transactions.push(transaction);
      this.state = transaction.state;
    },
  };
  // Start with an unsaved edit/undo entry before changing the workbench theme.
  view.dispatch({
    changes: { from: source.length, insert: " changed" },
    userEvent: "input",
  });
  view.transactions = [];
  const plugin = extension
    .find((item) => item instanceof ViewPlugin)
    .create(view);
  t.after(() => plugin.destroy());
  const widget = () => {
    const widgets = [];
    for (const decorations of view.state.facet(EditorView.decorations)) {
      decorations.between(
        0,
        view.state.doc.length,
        (_from, _to, decoration) => {
          if (decoration.spec.widget) widgets.push(decoration.spec.widget);
        },
      );
    }
    assert.equal(widgets.length, 1);
    return widgets[0];
  };
  const changeTheme = (name) => {
    classes.clear();
    classes.add(name);
    observers[0].callback();
  };
  return { view, plugin, observers, document, widget, changeTheme };
}

for (const editing of [false, true]) {
  test(`workbench theme changes invalidate ${editing ? "live source" : "read"} Mermaid previews without editing the document`, (t) => {
    const { view, observers, document, widget, changeTheme } = fixture(t, {
      editing,
    });
    const before = view.state;
    const light = widget();
    assert.equal(light.theme, "default");
    assert.equal(observers[0].target, document.body);
    assert.deepEqual(observers[0].options, {
      attributes: true,
      attributeFilter: ["class"],
    });

    changeTheme("vscode-dark");
    const dark = widget();
    assert.equal(dark.theme, "dark");
    assert.equal(
      light.eq(dark),
      false,
      "An unchanged source must receive a fresh SVG for the new theme",
    );
    assert.equal(dark.source, light.source);
    assert.equal(dark.textFrom, light.textFrom);
    assert.equal(view.state.doc, before.doc);
    assert.equal(view.state.selection, before.selection);
    assert.equal(undoDepth(view.state), undoDepth(before));
    assert.equal(undoDepth(before), 1);
    assert.equal(view.transactions.length, 1);
    assert.equal(view.transactions[0].docChanged, false);
    assert.equal(view.transactions[0].selection, undefined);

    changeTheme("vscode-high-contrast-light");
    assert.equal(widget().theme, "default");
    assert.equal(dark.eq(widget()), false);
    assert.equal(view.state.doc, before.doc);
    assert.equal(view.state.selection, before.selection);
  });
}

test("equivalent or unrelated body class changes do not re-render Mermaid", (t) => {
  const { view, widget, changeTheme } = fixture(t);
  const before = widget();
  changeTheme("vscode-high-contrast-light");
  assert.equal(view.transactions.length, 0);
  assert.equal(widget(), before);
  changeTheme("vscode-dark");
  assert.equal(view.transactions.length, 1);
  const dark = widget();
  changeTheme("vscode-high-contrast");
  assert.equal(view.transactions.length, 1);
  assert.equal(widget(), dark);
});

test("disposing an editor disconnects theme observation and cancels a queued scroll refresh", async (t) => {
  const { view, plugin, observers, changeTheme } = fixture(t);
  plugin.update({
    view,
    viewportChanged: true,
    docChanged: false,
    selectionSet: false,
  });
  plugin.destroy();
  changeTheme("vscode-dark");
  await Promise.resolve();
  assert.equal(observers[0].disconnected, true);
  assert.equal(view.transactions.length, 0);
});
