import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("VS Code Mermaid uses shared automatic sizing and source actions without a visual builder", async () => {
  const [mermaid, webview, viewport, theme] = await Promise.all([
    read("vendor/markdown/mermaid.js"),
    read("src/webview/main.js"),
    read("vendor/aic-editor-core/mermaid-viewport.js"),
    read("src/webview/theme.css"),
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
  assert.doesNotMatch(viewport, /Zoom in|Zoom out|Reset diagram view/u);
  assert.doesNotMatch(
    mermaid,
    /controller\.controls|viewportController\.controls/u,
  );
  assert.doesNotMatch(viewport, /Rotate diagram|rotation/u);
  assert.match(
    theme,
    /\.cm-editor \.cm-content \.cm-md-mermaid\s*\{[^}]*box-sizing:\s*border-box/u,
    "The full-width editing preview must include its padding and border",
  );
});
