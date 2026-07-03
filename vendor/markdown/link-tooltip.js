// ADAPTED from aic modules/markdown/web/src/link-tooltip.js (see
// PROVENANCE.md). Changes: @aic/components IconButton → the local stub;
// window.open → host.bus.publish("link.external") — a VS Code webview blocks
// window.open, the extension host owns navigation. Everything else verbatim.
//
// Link tooltip — shows the URL with open/edit/unlink actions whenever the
// MAIN cursor sits inside a Link node. Tap places the cursor → same code
// path as keyboard.

import { showTooltip } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { IconButton } from "./components-stub.js";

// a URL with a real scheme (http://, mailto:, tel:) or a protocol-relative
// //host opens externally; anything else is a LOCAL project path
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

// resolve a scheme-less link to a project-relative path: a leading "/" is
// project-root, otherwise it is relative to the folder of the file the link
// lives in (drops #anchor and ?query)
function resolveLocal(url, host) {
  const clean = url.split("#")[0].split("?")[0].trim();
  if (clean.startsWith("/")) return clean.replace(/^\/+/, "");
  const base = host?.editor?.getActiveBuffer?.()?.path ?? "";
  const parts = base.includes("/") ? base.slice(0, base.lastIndexOf("/")).split("/") : [];
  for (const seg of clean.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export function openLink(url, host) {
  const dest = url?.trim();
  if (!dest) return;
  if (EXTERNAL.test(dest) || /^[#?]/.test(dest) || !host) {
    host?.bus?.publish("link.external", { url: dest });
    return;
  }
  // a scheme-less link with a path — open the local file in the editor
  const path = resolveLocal(dest, host);
  if (!path) return; // nothing resolvable — never publish an empty path
  host.bus.publish("file.open", { path });
}

function linkAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, 0);
  while (node && node.name !== "Link") node = node.parent;
  if (!node) return null;
  const url = node.getChild("URL");
  return {
    from: node.from,
    to: node.to,
    url: url ? state.sliceDoc(url.from, url.to) : "",
    urlFrom: url?.from ?? node.to - 1,
    urlTo: url?.to ?? node.to - 1,
  };
}

function make(link, host) {
  return {
    pos: link.from,
    above: true,
    create(view) {
      const dom = document.createElement("div");
      dom.className = "cm-md-link-tooltip";
      // the buttons must NOT steal focus from the editor on mousedown:
      // "edit" only sets a selection, which is invisible (and typing goes
      // nowhere) once the editor is blurred
      dom.onmousedown = (event) => event.preventDefault();
      const url = document.createElement("span");
      url.textContent = link.url || "(empty url)";
      const open = IconButton({
        icon: "external",
        label: "open",
        onClick: () => openLink(link.url, host),
      });
      const edit = IconButton({
        icon: "edit",
        label: "edit",
        onClick: () => {
          view.dispatch({
            selection: { anchor: link.urlFrom, head: link.urlTo },
            scrollIntoView: true,
          });
          view.focus(); // typing replaces the URL immediately
        },
      });
      const unlink = IconButton({
        icon: "trash",
        label: "unlink",
        onClick: () => {
          const text = view.state.sliceDoc(link.from, link.to);
          const inner = text.replace(/^\[([^\]]*)\].*$/s, "$1");
          view.dispatch({ changes: { from: link.from, to: link.to, insert: inner } });
        },
      });
      dom.append(url, open, edit, unlink);
      return { dom };
    },
  };
}

export function linkTooltip(host) {
  return StateField.define({
    create: () => null,
    update(value, tr) {
      if (!tr.selection && !tr.docChanged) return value;
      return linkAt(tr.state, tr.state.selection.main.head);
    },
    provide: (field) =>
      showTooltip.compute([field], (state) => {
        const link = state.field(field);
        return link ? make(link, host) : null;
      }),
  });
}
