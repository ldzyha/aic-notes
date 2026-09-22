import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("VS Code Mermaid uses source and preview controls without a visual builder", async () => {
  const [mermaid, webview, viewport] = await Promise.all([
    read("vendor/markdown/mermaid.js"),
    read("src/webview/main.js"),
    read("vendor/aic-editor-core/mermaid-viewport.js"),
  ]);
  assert.match(mermaid, /createMermaidViewport/u);
  assert.match(mermaid, /icon: "copy"/u);
  assert.match(mermaid, /icon: "edit"/u);
  assert.match(mermaid, /new EditingPreviewWidget/u);
  assert.doesNotMatch(
    mermaid,
    /DiagramSourceActionsWidget|createDiagramEditButton/u,
  );
  assert.doesNotMatch(
    webview,
    /DIAGRAM_BUILDER_CSS|DIAGRAM_PALETTE_CSS|DIAGRAM_SESSION_CSS/u,
  );
  assert.match(viewport, /Zoom in/u);
  assert.doesNotMatch(viewport, /Rotate diagram|rotation/u);
});
