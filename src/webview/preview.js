// Mermaid preview page — the panel half of the live preview. Dumb by design:
// it renders whatever the extension host posts (`render`/`empty`) via the
// vendored renderInto in its "float" context (structured error card,
// newest-render-wins, SVG swapped in place — no blank, no scroll jump). The
// caret logic lives in the editor webview (mermaid-preview.js), the panel
// lifecycle in src/preview/manager.js. Posts `ready` on every script load so
// a reload (e.g. after floating to an OS window) restores the last diagram.

import { renderInto } from "../../vendor/markdown/mermaid.js";
import { IconButton } from "../../vendor/markdown/components-stub.js";
import THEME_CSS from "./theme.css";

const PREVIEW_CSS = `
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); }
.aicn-preview-head { display: flex; align-items: center; gap: .5rem;
  padding: .3rem .5rem; border-bottom: 1px solid var(--border); }
.aicn-preview-origin { color: var(--muted); flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aicn-preview-body { padding: .5rem; overflow: auto; }
.aicn-preview-body svg { max-width: 100%; height: auto; }
.aicn-preview-empty { color: var(--muted); font-style: italic; }
.aicn-error-card { border: 1px dashed var(--warn); border-radius: var(--radius);
  padding: .4rem .6rem; }
.aicn-error-head { color: var(--warn); font-weight: 700; }
.aicn-error-detail { color: var(--fg); white-space: pre-wrap; margin-top: .3rem; }
.aicn-error-fix { color: var(--muted); margin-top: .2rem; }
.cm-md-mermaid-loading { color: var(--muted); font-style: italic; }
`;

const api = acquireVsCodeApi();

for (const css of [THEME_CSS, PREVIEW_CSS]) {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
}

const head = document.createElement("div");
head.className = "aicn-preview-head";
const origin = document.createElement("span");
origin.className = "aicn-preview-origin";
head.append(
  origin,
  IconButton({
    icon: "external",
    label: "float",
    onClick: () => api.postMessage({ type: "float" }),
  }),
);

const body = document.createElement("div");
body.className = "aicn-preview-body";

document.body.append(head, body);

function showEmpty() {
  origin.textContent = "";
  const empty = document.createElement("span");
  empty.className = "aicn-preview-empty";
  empty.textContent = "no mermaid fence at the caret";
  body.replaceChildren(empty);
}

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "render") {
    origin.textContent = msg.origin ?? "";
    // renderInto swaps an existing <svg> in place; after `empty` cleared the
    // body there is none, so it starts from its loading chip — both fine
    renderInto(body, msg.source, "float");
  } else if (msg.type === "empty") {
    showEmpty();
  }
});

showEmpty();
api.postMessage({ type: "ready" });
