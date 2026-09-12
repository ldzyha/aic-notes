import { createContextSphere } from "../../vendor/aic-editor-core/context-sphere.js";
import css from "../../vendor/aic-editor-core/context-sphere.css";

const api = acquireVsCodeApi();
const style = document.createElement("style");
style.textContent = `:root{--aic-fg:var(--vscode-foreground);--aic-border:var(--vscode-panel-border)}
html,body{margin:0;padding:0;color:var(--aic-fg);background:var(--vscode-sideBar-background)}
#sphere{width:100%;min-width:0} ${css}`;
document.head.append(style);
const sphere = createContextSphere(document.getElementById("sphere"), {
  state: api.getState() || undefined,
  onStateChange: (state) => api.setState(state),
  onOpen: (id) => api.postMessage({ type: "open", id }),
  onPin: (id, pinned) => api.postMessage({ type: "pin", id, pinned }),
});
const receive = (event) => {
  if (event.data?.type === "graph") sphere.update(event.data.graph);
};
window.addEventListener("message", receive);
window.addEventListener(
  "pagehide",
  () => {
    window.removeEventListener("message", receive);
    sphere.dispose();
  },
  { once: true },
);
api.postMessage({ type: "ready" });
