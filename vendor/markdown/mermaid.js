// ADAPTED from aic modules/markdown/web/src/mermaid.js (see PROVENANCE.md).
// Kept: the in-place widget path — mermaidFences, MermaidWidget, renderInto,
// makeMermaidExtension (StateField + scroll-refresh ViewPlugin), the lazy
// mermaid chunk with the structured mermaid_bundle_missing error. Stripped:
// the visual builder profiles/console and the AI error-explain (coupled to
// aic's host.ui.console / host.providers). aic's caret-follow preview
// (console slot / float) is reshaped as the ONE-PAGE inline editing preview
// (owner 2026-07-06: no extra preview tab): while the caret edits a fence's
// source, EditingPreviewWidget renders the live diagram directly below the
// fence, debounced ~300ms, same DOM across keystrokes (no flicker).
// renderInto keeps the upstream context param: "widget" = the read view
// (one-line error marker, detail in title), "float" = the editing preview
// (structured ErrorCard inline). Theme picks dark/light off the VS Code body
// class instead of a fixed "dark".

import { Decoration, EditorView, WidgetType, ViewPlugin } from "@codemirror/view";
import { StateField, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Icon, ErrorCard } from "./components-stub.js";
import { selectionRevealsPreview } from "../aic-editor-core/structured-preview.js";

let mermaidPromise = null;
let renderSeq = 0;

function mermaidTheme() {
  const cls = document.body?.classList;
  if (cls?.contains("vscode-light")) return "default";
  if (cls?.contains("vscode-high-contrast-light")) return "default";
  return "dark";
}

function loadMermaid() {
  mermaidPromise ??= import("mermaid")
    .then((m) => {
      const mermaid = m.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: mermaidTheme(),
        securityLevel: "strict",
        // never let mermaid inject its full-width error DOM into the page
        suppressErrorRendering: true,
      });
      return mermaid;
    })
    .catch((e) => {
      mermaidPromise = null;
      throw Object.assign(new Error("mermaid_bundle_missing"), {
        structured: {
          error: "mermaid_bundle_missing",
          detail: `the mermaid chunk failed to load: ${e}`,
          fix: ["Rebuild the extension: npm run build", "then reload the window"],
        },
      });
    });
  return mermaidPromise;
}

// context "widget" = the in-editor block (one-line error marker, detail in
// title); "float" = the preview panel (full structured error card) — the
// upstream aic signature, restored for the preview
export async function renderInto(el, source, context = "widget") {
  const id = `aicn-mmd-${renderSeq++}`;
  const token = (el.__rseq = (el.__rseq || 0) + 1); // newest-render-wins guard
  // keep the current diagram visible while the next one renders, then SWAP
  // the <svg> in place; the loading chip shows only on first paint
  if (!el.querySelector("svg")) {
    el.innerHTML = "";
    const loading = document.createElement("span");
    loading.className = "cm-md-mermaid-loading";
    loading.textContent = "loading mermaid…";
    el.appendChild(loading);
  }
  try {
    const mermaid = await loadMermaid();
    const { svg } = await mermaid.render(id, source);
    if (el.__rseq !== token) return true; // superseded by a newer render
    const holder = document.createElement("div");
    holder.innerHTML = svg;
    const next = holder.firstElementChild;
    const cur = el.querySelector("svg");
    if (cur && next) cur.replaceWith(next);
    else el.replaceChildren(next || holder);
    return true;
  } catch (e) {
    // belt to suppressErrorRendering's suspenders: drop any orphan DOM
    // mermaid attached outside our element
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
    if (el.__rseq !== token) return false;
    const structured = e.structured ?? {
      error: "mermaid_parse_error",
      detail: String(e?.message ?? e),
      fix: ["Put the cursor inside the fence to edit the source"],
    };
    if (context === "float") {
      el.replaceChildren(ErrorCard(structured));
      return false;
    }
    const marker = document.createElement("span");
    marker.className = "cm-md-mermaid-broken";
    marker.append(Icon("warn"), ` mermaid: ${structured.error} — use Edit`);
    marker.title = structured.detail;
    el.replaceChildren(marker);
    return false;
  }
}

// zoom bar (owner 2026-07-06: diagrams full width + zoomable). Layout-only
// zoom — the svg's CSS width rides --mmd-zoom, container pans via
// overflow-x — no CSS transform (Crostini GPU rule). Lives on the WRAPPER,
// outside renderInto's replaceChildren target, so it survives re-renders.
// Buttons stop propagation so they never move the editor selection.
function attachZoom(el) {
  let zoom = 100;
  const bar = document.createElement("div");
  bar.className = "cm-md-mermaid-zoom";
  const apply = () => el.style.setProperty("--mmd-zoom", `${zoom}%`);
  const btn = (label, title, fn) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.onmousedown = (event) => event.preventDefault(); // keep editor focus
    b.onclick = (event) => {
      event.stopPropagation();
      fn();
      apply();
    };
    bar.appendChild(b);
  };
  btn("−", "zoom out", () => (zoom = Math.max(50, zoom - 25)));
  btn("+", "zoom in", () => (zoom = Math.min(400, zoom + 25)));
  btn("↺", "reset zoom", () => (zoom = 100));
  el.appendChild(bar);
}

// wrapper = .cm-md-mermaid (zoom bar + var); inner body = renderInto target
function diagramShell(className) {
  const el = document.createElement("div");
  el.className = className;
  const body = document.createElement("div");
  body.className = "cm-md-mermaid-body";
  el.appendChild(body);
  attachZoom(el);
  return { el, body };
}

class MermaidWidget extends WidgetType {
  constructor(source, from, to, textFrom, host) {
    super();
    this.source = source;
    this.from = from;
    this.to = to;
    this.textFrom = textFrom;
    this.host = host;
  }
  eq(other) {
    return other.source === this.source && other.from === this.from &&
      other.to === this.to;
  }
  toDOM(view) {
    const { el, body } = diagramShell("cm-md-mermaid");
    el.classList.add("cm-md-block-preview");
    el.dataset.aicSourceFrom = String(this.from);
    el.dataset.aicSourceTo = String(this.to);
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Mermaid diagram preview");
    const header = document.createElement("div");
    header.className = "cm-md-preview-header";
    const title = document.createElement("span");
    title.textContent = "Mermaid";
    const actions = document.createElement("span");
    actions.className = "cm-md-preview-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "cm-md-edit-source";
    copy.textContent = "Copy";
    copy.onmousedown = (event) => event.preventDefault();
    copy.onclick = (event) => {
      event.stopPropagation();
      this.host.bus.publish("clipboard.write", { text: this.source, label: "Mermaid source" });
    };
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "cm-md-edit-source";
    edit.textContent = view.state.readOnly ? "View source" : "Edit";
    edit.onmousedown = (event) => event.preventDefault();
    edit.onclick = (event) => {
      event.stopPropagation();
      view.dispatch({ selection: { anchor: this.textFrom }, scrollIntoView: true });
      view.focus();
    };
    actions.append(copy, edit);
    header.append(title, actions);
    el.prepend(header);
    renderInto(body, this.source);
    return el;
  }
  ignoreEvent() {
    return true; // the widget owns its activation — CM must not move the
    // cursor into the fence (that would swap the widget for the source)
  }
}

// the inline editing preview — shown below a fence WHILE the caret edits its
// source (the reveal rule shows raw text, so this is the only moment the
// diagram is otherwise invisible). CM swaps widgets whose eq() differs by
// calling updateDOM on the existing element: the debounce lives there, the
// DOM persists, renderInto's newest-wins guard + in-place SVG swap keep it
// flicker-free.
class EditingPreviewWidget extends WidgetType {
  constructor(source) {
    super();
    this.source = source;
  }
  eq(other) {
    return other.source === this.source;
  }
  toDOM() {
    const { el, body } = diagramShell("cm-md-mermaid cm-md-mermaid-editing");
    el.setAttribute("aria-label", "live mermaid preview");
    renderInto(body, this.source, "float");
    return el;
  }
  updateDOM(el) {
    clearTimeout(el.__aicnTimer);
    el.__aicnTimer = setTimeout(() => {
      const body = el.querySelector(".cm-md-mermaid-body") ?? el;
      renderInto(body, this.source, "float");
    }, 300);
    return true;
  }
  destroy(el) {
    clearTimeout(el.__aicnTimer);
  }
  ignoreEvent() {
    return true; // read-only surface — clicks must not move the caret
  }
}

export function mermaidFences(state) {
  const fences = [];
  syntaxTree(state).iterate({
    enter(nodeRef) {
      if (nodeRef.name !== "FencedCode") return;
      const info = nodeRef.node.getChild("CodeInfo");
      if (!info || state.sliceDoc(info.from, info.to).trim().toLowerCase() !== "mermaid") return;
      const text = nodeRef.node.getChild("CodeText");
      // an empty fence has no CodeText — the writable point sits right
      // after the opening line
      const afterOpen = Math.min(state.doc.lineAt(nodeRef.from).to + 1, nodeRef.to);
      fences.push({
        from: nodeRef.from,
        to: nodeRef.to,
        textFrom: text ? text.from : afterOpen,
        textTo: text ? text.to : afterOpen,
        source: text ? state.sliceDoc(text.from, text.to) : "",
      });
    },
  });
  return fences;
}

// rebuild trigger for SCROLL. CM6 lazy-parses the syntax tree to the viewport,
// so a mermaid fence scrolled into view isn't in mermaidFences() yet — and the
// StateField below only rebuilds on doc/selection changes. The ViewPlugin
// fires this effect on viewport changes so off-screen diagrams render on
// scroll, not only on click.
const refreshMermaid = StateEffect.define();

export function makeMermaidExtension(host) {
  // Block widgets live in a StateField mapped through changes (pinned:
  // CM6 requires block decorations outside ViewPlugins).
  const field = StateField.define({
    create(state) {
      return build(state);
    },
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshMermaid))) {
        return build(tr.state);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  function build(state) {
    const decorations = [];
    for (const fence of mermaidFences(state)) {
      if (!fence.source.trim()) continue;
      const inside =
        state.selection.ranges.some(
          (range) =>
            range.empty && range.from >= fence.from && range.from <= fence.to,
        ) ||
        selectionRevealsPreview(state.selection.ranges, fence.from, fence.to);
      if (inside) {
        // editing: raw source stays visible, the live diagram renders below
        decorations.push(
          Decoration.widget({
            widget: new EditingPreviewWidget(fence.source),
            block: true,
            side: 1,
          }).range(fence.to),
        );
      } else {
        decorations.push(
          Decoration.replace({
            widget: new MermaidWidget(
              fence.source,
              fence.from,
              fence.to,
              fence.textFrom,
              host,
            ),
            block: true,
          }).range(fence.from, fence.to),
        );
      }
    }
    return Decoration.set(decorations, true);
  }

  // re-decorate when the viewport scrolls so newly-visible (newly-parsed)
  // fences render without a click. Effect-only transaction (no doc/viewport
  // change) so it can't loop; dispatched after the update settles.
  const onScroll = ViewPlugin.fromClass(
    class {
      update(u) {
        if (u.viewportChanged && !u.docChanged && !u.selectionSet) {
          Promise.resolve().then(() => {
            try {
              u.view.dispatch({ effects: refreshMermaid.of(null) });
            } catch {
              /* view torn down */
            }
          });
        }
      }
    },
  );

  return [field, onScroll];
}
