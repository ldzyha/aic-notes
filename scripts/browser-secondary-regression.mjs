// Production webview bundle + real provider scaffold, synthetic data only.
// No VS Code account, workspace notes, or remote requests are used.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "dist", "webview");
const provider = await readFile(
  path.join(root, "src/secondary/provider.js"),
  "utf8",
);
const scaffold = provider.match(
  /`(<span id="pane-status"[\s\S]*?<\/footer>)`/u,
)?.[1];
assert.ok(scaffold, "use the production Secondary HTML scaffold");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
const passed = [];
const origin = "http://aic-webview.test";
const themes = {
  dark: "--vscode-editor-background:#191a1b;--vscode-editor-foreground:#bfbfbf;--vscode-sideBar-background:#222324;--vscode-descriptionForeground:#92999f;--vscode-panel-border:#454749;--vscode-textLink-foreground:#45a6c4;--vscode-editorWarning-foreground:#d9a441",
  light:
    "--vscode-editor-background:#ffffff;--vscode-editor-foreground:#20242b;--vscode-sideBar-background:#f5f6f7;--vscode-descriptionForeground:#68717d;--vscode-panel-border:#d8dde5;--vscode-textLink-foreground:#1976d2;--vscode-editorWarning-foreground:#9c6500",
};
async function openPage({
  secondary = true,
  theme = "dark",
  width = 490,
  rootFont = 16,
} = {}) {
  const page = await browser.newPage({ viewport: { width, height: 790 } });
  page.setDefaultTimeout(6000);
  await page.addInitScript(() => {
    window.clipboardWrites = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => window.clipboardWrites.push(text) },
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      errors.push(`Unexpected request: ${url.origin}`);
      return route.abort();
    }
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>:root{font-size:${rootFont}px;${themes[theme]}}</style></head><body class="${secondary ? "aic-secondary-surface" : ""}">${secondary ? scaffold : '<div id="editor"></div>'}<script>window.messages=[];window.savedState=null;window.acquireVsCodeApi=()=>({getState:()=>window.savedState,setState:s=>window.savedState=s,postMessage:m=>window.messages.push(m)});</script><script type="module" src="/main.js"></script></body></html>`,
      });
    }
    const file = path.resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    assert.ok(file.startsWith(`${assets}${path.sep}`));
    await route.fulfill({
      body: await readFile(file),
      contentType: file.endsWith(".js") ? "text/javascript" : "font/woff2",
    });
  });
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.messages.some((m) => m.type === "ready"),
  );
  return page;
}
const post = (page, data) =>
  page.evaluate(
    (message) =>
      new Promise((resolve) => {
        const received = (event) => {
          if (event.source !== window || event.data?.type !== message.type)
            return;
          window.removeEventListener("message", received);
          resolve();
        };
        window.addEventListener("message", received);
        window.postMessage(message, "*");
      }),
    data,
  );
const state = (page, expected) =>
  page.waitForFunction(
    (value) => document.body.dataset.saveState === value,
    expected,
  );
const commits = (page) =>
  page.evaluate(() => window.messages.filter((m) => m.type === "commit"));
let snapshotSerial = 0;
async function sourceSnapshot(page, relativePath) {
  const requestId = `browser-check-${++snapshotSerial}`;
  await post(page, { type: "editing.probe", requestId, relativePath });
  const snapshot = await page.evaluate(
    (id) =>
      window.messages.find(
        (message) =>
          message.type === "editing.snapshot" && message.requestId === id,
      ),
    requestId,
  );
  await post(page, { type: "editingState", relativePath, readOnly: false });
  assert.ok(snapshot, "production webview supplies an inspection snapshot");
  return snapshot.text;
}
const diagramGeometry = (locator) =>
  locator.evaluate((svg) => ({
    viewBox: svg.getAttribute("viewBox"),
    nodes: [...svg.querySelectorAll("g.node")].map((node) => ({
      transform: node.getAttribute("transform"),
      text: node.textContent,
    })),
  }));
const source =
  "---\nfile: Project.note.md\ncreated: 2026-09-02T12:00:00Z\nupdated: 2026-09-10T12:00:00Z\n---\n\n# Project\n\nWrite here.";
const relationships = [
  {
    path: "Project.note.md",
    label: "Project",
    relation: "project",
    depth: 0,
    exists: true,
    isCurrent: true,
  },
];
async function init(
  page,
  text = source,
  placeholder = false,
  relativePath = "Project.note.md",
) {
  await post(page, {
    type: "init",
    text,
    relativePath,
    generation: 0,
    placeholder,
    relationships,
    selection: { anchor: text.length, head: text.length },
  });
  await post(page, {
    type: "paneState",
    title: relativePath,
    hasSurface: true,
    hasPlaceholder: placeholder,
    canPin: true,
    canTrash: !placeholder,
    canOpenTarget: true,
  });
  await page.locator(".cm-content").waitFor();
}
try {
  for (const theme of ["dark", "light"]) {
    const page = await openPage({ theme });
    await init(page);
    await state(page, "saved");
    assert.equal(
      await page
        .locator("#secondary-controls, #pane-name, #pane-breadcrumb")
        .count(),
      0,
    );
    assert.ok(await page.locator("#pane-save-indicator").isHidden());
    const baseColor = await page
      .locator(".cm-editor")
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(
      (await page.getByText("Properties", { exact: true }).boundingBox()).y <
        45,
      "properties start at top, not below a duplicate header",
    );
    await page.keyboard.insertText(" Changed.");
    await state(page, "dirty");
    assert.ok(await page.locator("#pane-save-indicator").isVisible());
    assert.notEqual(
      await page
        .locator(".cm-editor")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      baseColor,
    );
    await page.locator("#pane-pin").click();
    assert.equal((await commits(page)).length, 0, "input and blur never save");
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() =>
      window.messages.some((m) => m.type === "commit"),
    );
    const first = (await commits(page)).at(-1);
    await post(page, {
      ...first,
      type: "committed",
      saved: true,
      text: first.text.replace("2026-09-10T12:00:00Z", "2026-09-11T12:00:00Z"),
    });
    await state(page, "saved");
    assert.equal(
      await page
        .locator(".cm-editor")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
      baseColor,
    );
    assert.ok(await page.locator("#pane-save-indicator").isHidden());
    if (theme === "dark" && process.env.AIC_REVIEW_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.AIC_REVIEW_SCREENSHOTS,
          "2026-09-11-note-saved.png",
        ),
      });
    }
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" Next.");
    await page.keyboard.press("Control+s");
    const second = (await commits(page)).at(-1);
    await page.keyboard.insertText(" Newer.");
    await post(page, { ...second, type: "committed", saved: true });
    await state(page, "dirty");
    await page.keyboard.press("Control+s");
    const third = (await commits(page)).at(-1);
    assert.ok(
      third.text.endsWith(" Next. Newer."),
      "late success cannot replace newer input",
    );
    await post(page, { ...third, type: "committed", saved: false });
    await state(page, "dirty");
    if (theme === "dark" && process.env.AIC_REVIEW_SCREENSHOTS) {
      await page.screenshot({
        path: path.join(
          process.env.AIC_REVIEW_SCREENSHOTS,
          "2026-09-11-note-dirty.png",
        ),
      });
    }
    await page.keyboard.press("Control+s");
    const retry = (await commits(page)).at(-1);
    assert.equal(
      retry.text,
      third.text,
      "failed save keeps source and allows retry",
    );
    assert.notEqual(retry.requestId, third.requestId);
    await post(page, { ...retry, type: "committed", saved: true });
    await state(page, "saved");
    await page
      .getByRole("button", { name: "Open project note Project" })
      .click();
    assert.ok(
      await page.evaluate(() =>
        window.messages.some(
          (m) =>
            m.topic === "note.open" && m.payload.path === "Project.note.md",
        ),
      ),
    );
    await init(page, source, true, "new.note.md");
    await state(page, "placeholder");
    await post(page, { ...third, type: "committed", saved: true });
    await state(page, "placeholder");
    const before = (await commits(page)).length;
    await page.keyboard.press("Control+s");
    assert.equal(
      (await commits(page)).length,
      before,
      "unchanged placeholder does not create a file",
    );
    await page.keyboard.insertText(" New note.");
    await state(page, "dirty");
    passed.push(
      `${theme}: compact header, saved/dirty/placeholder, explicit save, late input, failed retry, project navigation`,
    );
    await page.close();
  }
  const page = await openPage({ secondary: false, width: 1180 });
  for (const diagram of [
    "sequenceDiagram\nparticipant A\nparticipant B\nA->>B: Message",
    "classDiagram\nclass Source\nclass Target\nSource --> Target : uses",
  ]) {
    const text = `# Diagram\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n`;
    const anchor = text.indexOf(diagram) + diagram.indexOf("\n") + 1;
    await post(page, {
      type: "init",
      text,
      generation: 0,
      relativePath: "diagram.md",
      selection: { anchor, head: anchor },
    });
    const toolbar = page.getByRole("toolbar", {
      name: "Mermaid source actions",
    });
    await toolbar.waitFor();
    await toolbar
      .getByRole("button", { name: "Edit diagram visually" })
      .click();
    await page.locator(".cm-aic-diagram-inline").waitFor();
    assert.equal(
      await page.locator("dialog").count(),
      0,
      "visual edits are inline, never a dialog",
    );
    if (
      diagram.startsWith("classDiagram") &&
      process.env.AIC_REVIEW_SCREENSHOTS
    ) {
      await page.screenshot({
        path: path.join(
          process.env.AIC_REVIEW_SCREENSHOTS,
          "2026-09-11-diagram-builder.png",
        ),
      });
    }
    await page.getByRole("button", { name: "Cancel diagram changes" }).click();
    assert.equal(
      await page.evaluate(
        () => window.messages.filter((m) => m.type === "edit").length,
      ),
      0,
    );
    const selection = await page.evaluate(() => window.savedState);
    assert.equal(selection.anchor, anchor);
    assert.equal(selection.head, anchor);
  }
  passed.push(
    "production AIC Markdown: source-mode class/sequence builder opens without edits or lost selection",
  );
  // Regression from the actual reported legacy /flowchart, in a narrow pane.
  // This must edit the actual Mermaid SVG inline, not a separate card layout.
  const narrow = await openPage({ width: 590 });
  const legacyFlow = [
    "flowchart LR",
    '    A["Input or central question"] --> B["Owned decision or process"]',
    '    B --> C["Outcome or consumer"]',
    '    B -. "Failure or optional path" .-> D["Recovery or omission"]',
  ].join("\n");
  await init(narrow, `# Diagram\n\n\`\`\`mermaid\n${legacyFlow}\n\`\`\`\n\n`);
  await narrow
    .getByRole("button", { name: "Edit diagram visually", exact: true })
    .click();
  await narrow.locator(".aic-db-viewport").waitFor();
  await narrow.waitForFunction(
    () =>
      document.querySelectorAll(".aic-db-viewport [data-node-id]").length === 4,
  );
  assert.ok(await narrow.locator(".aic-db-source").isHidden());
  assert.equal(await narrow.locator("dialog").count(), 0);
  assert.equal(
    await narrow.locator(".cm-content .cm-aic-diagram-inline").count(),
    1,
  );
  assert.equal(await narrow.locator(".aic-db-viewport svg").count(), 1);
  await narrow
    .getByRole("combobox", { name: "Direction", exact: true })
    .selectOption("TB");
  const nodeA = narrow.locator('[data-node-id="A"]');
  await narrow.waitForFunction(() => {
    const a = document
      .querySelector('[data-node-id="A"]')
      ?.getBoundingClientRect();
    const b = document
      .querySelector('[data-node-id="B"]')
      ?.getBoundingClientRect();
    return a && b && b.y > a.y + a.height;
  });
  await nodeA.click();
  await narrow
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Initial question");
  await narrow
    .getByRole("combobox", { name: "Element type", exact: true })
    .selectOption("diamond");
  await narrow
    .getByRole("button", {
      name: "Connect Owned decision or process",
      exact: true,
    })
    .dragTo(nodeA);
  assert.equal(
    await narrow
      .getByRole("combobox", { name: "Relationship type", exact: true })
      .inputValue(),
    "-->",
    "drag-connecting defaults to a solid arrow",
  );
  await narrow
    .getByRole("textbox", { name: "Message / event", exact: true })
    .fill("Review again");
  await narrow
    .getByRole("combobox", { name: "Relationship type", exact: true })
    .selectOption("-.->");
  await narrow.waitForFunction(
    () => document.querySelectorAll(".aic-db-edge-hit").length === 4,
  );
  await narrow
    .getByRole("button", { name: "Add state", exact: true })
    .dragTo(narrow.locator(".aic-db-viewport"), {
      targetPosition: { x: 100, y: 100 },
    });
  await narrow
    .getByRole("textbox", { name: "Label", exact: true })
    .fill("Review result");
  await narrow.waitForFunction(
    () =>
      document.querySelectorAll(".aic-db-viewport [data-node-id]").length === 5,
  );
  const canvasBox = await narrow.locator(".aic-db-viewport").boundingBox();
  const inspectorBox = await narrow.locator(".aic-db-inspector").boundingBox();
  assert.ok(canvasBox.height >= 100);
  assert.ok(
    inspectorBox.y + inspectorBox.height <= canvasBox.y + 2,
    "compact context bar stays above the canvas",
  );
  assert.ok(
    inspectorBox.width >= canvasBox.width,
    "no permanent side inspector consumes canvas width",
  );
  await narrow
    .getByRole("button", { name: "Fit diagram", exact: true })
    .click();
  const line = narrow.getByRole("button", {
    name: /^Edit relationship line: B --> C/u,
  });
  const linePoint = await line.evaluate((el) => {
    const matrix = el.getScreenCTM();
    for (let fraction = 0.1; fraction < 0.95; fraction += 0.05) {
      const point = el
        .getPointAtLength(el.getTotalLength() * fraction)
        .matrixTransform(matrix);
      if (document.elementFromPoint(point.x, point.y) === el)
        return { x: point.x, y: point.y };
    }
    return null;
  });
  if (!linePoint && process.env.AIC_REVIEW_SCREENSHOTS) {
    await narrow.screenshot({
      path: path.join(
        process.env.AIC_REVIEW_SCREENSHOTS,
        "2026-09-11-line-hit-debug.png",
      ),
    });
    process.stdout.write(
      JSON.stringify(
        await line.evaluate((el) => {
          const rect = el.getBoundingClientRect();
          const matrix = el.getScreenCTM();
          const point = el
            .getPointAtLength(el.getTotalLength() * 0.3)
            .matrixTransform(matrix);
          return {
            rect: rect.toJSON(),
            point: { x: point.x, y: point.y },
            hit: document
              .elementFromPoint(point.x, point.y)
              ?.outerHTML.slice(0, 500),
            path: el.outerHTML,
          };
        }),
      ) + "\n",
    );
  }
  assert.ok(linePoint, "relationship line itself is reachable on the canvas");
  await narrow.mouse.click(linePoint.x, linePoint.y);
  await narrow
    .getByRole("button", { name: "Reverse direction", exact: true })
    .click();
  await narrow
    .getByRole("textbox", { name: "Message / event", exact: true })
    .fill("Return");
  await narrow.waitForFunction(
    () =>
      document.querySelector(".aic-diagram-builder")?.dataset.renderState ===
      "ready",
  );
  const inlineGeometry = await diagramGeometry(
    narrow.locator(".aic-db-viewport svg"),
  );
  await narrow
    .getByRole("button", { name: "Copy Mermaid source", exact: true })
    .click();
  const copiedDraft = await narrow.evaluate(
    () =>
      window.messages
        .filter((message) => message.topic === "clipboard.write")
        .at(-1)?.payload.text ?? window.clipboardWrites.at(-1),
  );
  assert.match(
    copiedDraft,
    /C -->\|"Return"\| B/u,
    "Copy uses the current un-applied diagram draft",
  );
  if (process.env.AIC_REVIEW_SCREENSHOTS) {
    await narrow
      .getByRole("button", { name: "Fit diagram", exact: true })
      .click();
    await narrow.screenshot({
      path: path.join(
        process.env.AIC_REVIEW_SCREENSHOTS,
        "2026-09-11-flowchart-fixed.png",
      ),
    });
  }
  await narrow
    .getByRole("button", { name: "Apply diagram changes", exact: true })
    .click();
  await state(narrow, "dirty");
  const readSvg = narrow.locator(".cm-md-mermaid-body:visible svg");
  await readSvg.waitFor();
  assert.deepEqual(
    await diagramGeometry(readSvg),
    inlineGeometry,
    "read preview and inline editor use identical Mermaid geometry",
  );
  assert.equal(
    (await commits(narrow)).length,
    0,
    "diagram Apply doesn't save the note",
  );
  await narrow.keyboard.press("Control+s");
  const diagramCommit = (await commits(narrow)).at(-1);
  assert.match(diagramCommit.text, /A\{"Initial question"\}/u);
  assert.match(diagramCommit.text, /B -\.->\|"Review again"\| A/u);
  assert.match(diagramCommit.text, /N1\["Review result"\]/u);
  assert.match(diagramCommit.text, /C -->\|"Return"\| B/u);
  assert.match(diagramCommit.text, /Failure or optional path/u);
  assert.match(diagramCommit.text, /flowchart TB/u);
  assert.doesNotMatch(diagramCommit.text, /%% aic-builder-layout/u);
  passed.push(
    "inline Mermaid: legacy flowchart, LR/TB autolayout, palette/connection drag, context bar, line click, reverse, draft Copy, identical read/edit geometry, explicit save without layout metadata",
  );

  // Source-only diagrams still need normal code indentation, not focus loss.
  await init(
    narrow,
    "```mermaid\nflowchart LR\n  subgraph Group\n    A --> B\n  end\n```\n\n",
  );
  await narrow
    .getByRole("button", { name: "Edit diagram visually", exact: true })
    .click();
  const sourceEditor = narrow.getByRole("textbox", {
    name: "Mermaid diagram source",
    exact: true,
  });
  await sourceEditor.fill("flowchart LR\n    A --> B");
  await sourceEditor.press("Control+End");
  await sourceEditor.press("Enter");
  await narrow.keyboard.insertText("B --> C");
  assert.equal(
    await sourceEditor.inputValue(),
    "flowchart LR\n    A --> B\n    B --> C",
  );
  await sourceEditor.press("Home");
  await sourceEditor.press("Tab");
  assert.match(await sourceEditor.inputValue(), /\n {6}B --> C$/u);
  await sourceEditor.press("Shift+Tab");
  assert.match(await sourceEditor.inputValue(), /\n {4}B --> C$/u);
  assert.ok(await sourceEditor.evaluate((el) => el === document.activeElement));
  await narrow
    .getByRole("button", { name: "Cancel diagram changes", exact: true })
    .click();
  passed.push(
    "Mermaid source textarea: Enter preserves indentation, Tab/Shift+Tab indent without losing focus",
  );
  // The reported sidebar is much narrower in CSS pixels than our old screenshot.
  // Document font scaling must not inflate control sizes or starve the preview.
  const compactLayouts = [];
  for (const width of [300, 360, 590]) {
    for (const rootFont of [16, 24]) {
      const compact = await openPage({ width, rootFont });
      const compactSource =
        '# Diagram\n\n```mermaid\nflowchart LR\n A["Initial state"] --> B{"Condition"}\n```\n\n';
      await init(compact, compactSource);
      await compact
        .getByRole("button", { name: "Edit diagram visually", exact: true })
        .click();
      await compact.waitForFunction(
        () =>
          document.querySelector(".aic-diagram-builder")?.dataset
            .renderState === "ready",
      );
      const edgePoint = await compact
        .locator(".aic-db-edge-hit")
        .evaluate((edge) => {
          const point = edge
            .getPointAtLength(edge.getTotalLength() / 2)
            .matrixTransform(edge.getScreenCTM());
          return document.elementFromPoint(point.x, point.y) === edge
            ? { x: point.x, y: point.y }
            : null;
        });
      assert.ok(
        edgePoint,
        "the horizontal relationship has a real clickable stroke",
      );
      await compact.mouse.click(edgePoint.x, edgePoint.y);
      await compact
        .getByRole("textbox", { name: "Message / event", exact: true })
        .fill(
          "A description that remains one compact field even when it is long",
        );
      await compact.waitForFunction(
        () =>
          document.querySelector(".aic-diagram-builder")?.dataset
            .renderState === "ready",
      );
      const metrics = await compact
        .locator(".aic-diagram-builder")
        .evaluate((builder) => {
          const box = (selector) =>
            builder.querySelector(selector).getBoundingClientRect().toJSON();
          return {
            builder: builder.getBoundingClientRect().toJSON(),
            toolbar: box(".aic-db-toolbar"),
            palette: box(".aic-diagram-palette"),
            bar: box(".aic-db-inspector"),
            viewport: box(".aic-db-viewport"),
            copy: box('[aria-label="Copy Mermaid source"]'),
            undo: box('[aria-label="Undo diagram change"]'),
            font: getComputedStyle(builder.querySelector(".aic-db-field input"))
              .fontSize,
            overflow: builder.scrollWidth - builder.clientWidth,
          };
        });
      assert.ok(
        metrics.toolbar.height <= 34,
        JSON.stringify({ width, rootFont, metrics }),
      );
      assert.ok(metrics.palette.height <= 32);
      assert.ok(
        metrics.bar.height <= 40,
        "selected relationship is a bar, not a stacked form",
      );
      assert.ok(
        metrics.viewport.height >= 240 &&
          metrics.viewport.height >= metrics.builder.height / 2,
      );
      assert.equal(metrics.font, "12px");
      assert.equal(metrics.copy.height, metrics.undo.height);
      assert.ok(metrics.copy.height <= 30 && metrics.overflow <= 1);
      assert.ok(
        await compact
          .getByRole("combobox", { name: "From", exact: true })
          .isHidden(),
      );
      await compact
        .getByRole("button", { name: "Connection endpoints", exact: true })
        .click();
      await compact
        .getByRole("combobox", { name: "From", exact: true })
        .selectOption("B");
      assert.ok(
        await compact
          .getByRole("combobox", { name: "To", exact: true })
          .isVisible(),
      );
      await compact.keyboard.press("Escape");
      assert.ok(
        await compact
          .getByRole("combobox", { name: "From", exact: true })
          .isHidden(),
      );
      assert.equal(
        await compact.locator(".cm-aic-diagram-inline").count(),
        1,
        "Escape closes the field popover, not diagram editing",
      );
      assert.equal((await commits(compact)).length, 0);
      if (
        width === 300 &&
        rootFont === 24 &&
        process.env.AIC_REVIEW_SCREENSHOTS
      ) {
        await compact.screenshot({
          path: path.join(
            process.env.AIC_REVIEW_SCREENSHOTS,
            "2026-09-11-diagram-compact-sidebar.png",
          ),
        });
      }
      compactLayouts.push({
        width,
        rootFont,
        bar: metrics.bar.height,
        viewport: metrics.viewport.height,
      });
      await compact
        .getByRole("button", { name: "Cancel diagram changes", exact: true })
        .click();
      // Class members remain on-demand, with the same short Entity label.
      await init(
        compact,
        "```mermaid\nclassDiagram\n class Catalog {\n  +load()\n }\n```\n\n",
      );
      await compact
        .getByRole("button", { name: "Edit diagram visually", exact: true })
        .click();
      await compact.waitForFunction(
        () =>
          document.querySelector(".aic-diagram-builder")?.dataset
            .renderState === "ready",
      );
      await compact.locator('[data-node-id="Catalog"]').click();
      assert.equal(
        await compact
          .getByRole("combobox", { name: "Element type", exact: true })
          .locator("option:checked")
          .textContent(),
        "Entity",
      );
      assert.ok(
        await compact
          .getByRole("textbox", {
            name: "Properties and operations · one per line",
            exact: true,
          })
          .isHidden(),
      );
      await compact
        .getByRole("button", { name: "Entity members", exact: true })
        .click();
      await compact
        .getByRole("textbox", {
          name: "Properties and operations · one per line",
          exact: true,
        })
        .fill("+load()\n+retry()");
      assert.ok(
        (await compact.locator(".aic-db-viewport").boundingBox()).height >= 240,
      );
      await compact.keyboard.press("Escape");
      assert.equal(await compact.locator(".cm-aic-diagram-inline").count(), 1);
      await compact
        .getByRole("button", { name: "Cancel diagram changes", exact: true })
        .click();
      await init(
        compact,
        "```mermaid\nsequenceDiagram\n participant User\n participant Service\n User->>Service: Request\n```\n\n",
      );
      await compact
        .getByRole("button", { name: "Edit diagram visually", exact: true })
        .click();
      await compact.waitForFunction(
        () =>
          document.querySelector(".aic-diagram-builder")?.dataset
            .renderState === "ready",
      );
      await compact
        .getByRole("button", {
          name: "Edit relationship: Request",
          exact: true,
        })
        .click();
      assert.ok(
        (await compact.locator(".aic-db-inspector").boundingBox()).height <= 70,
      );
      assert.ok(
        (await compact.locator(".aic-db-viewport").boundingBox()).height >= 240,
      );
      assert.ok(
        (
          await compact
            .getByRole("textbox", { name: "Message / event", exact: true })
            .boundingBox()
        ).width >= 60,
      );
      await compact.close();
    }
  }
  passed.push(`compact semantic controls: ${JSON.stringify(compactLayouts)}`);
  for (const secondary of [true, false]) {
    const formatting = await openPage({ secondary, width: 590 });
    for (const relativePath of ["format.md", "format.note.md"]) {
      await init(formatting, "Point", false, relativePath);
      for (const [key, expected] of [
        ["Control+Alt+2", "## Point"],
        ["Control+Alt+2", "Point"],
        ["Control+Shift+8", "- Point"],
        ["Control+Shift+7", "1. Point"],
        ["Control+Shift+9", "- [ ] Point"],
      ]) {
        await formatting.locator(".cm-content").focus();
        await formatting.keyboard.press(key);
        assert.equal(
          await sourceSnapshot(formatting, relativePath),
          expected,
          `${secondary ? "sidebar" : "main"} ${relativePath}: ${key}`,
        );
      }
      await init(formatting, "- [ ] Task\n\nEnd", false, relativePath);
      await formatting.getByRole("checkbox").click();
      assert.match(
        await sourceSnapshot(formatting, relativePath),
        /- \[x\] Task/iu,
      );
      for (const query of ["checklist", "checkbox", "tasklist"]) {
        await init(formatting, "\n", false, relativePath);
        await formatting.locator(".cm-content").focus();
        await formatting.keyboard.type(`/${query}`);
        await formatting
          .getByRole("option")
          .filter({
            has: formatting.locator(".cm-completionLabel", {
              hasText: /^\/checklist$/u,
            }),
          })
          .click();
        assert.match(
          await sourceSnapshot(formatting, relativePath),
          /- \[ \] What needs to be done\?/u,
        );
      }
      const nested = "- Parent\n  - Child\n- Next";
      await init(formatting, nested, false, relativePath);
      await formatting.locator(".cm-content").focus();
      await formatting.keyboard.press("Control+Home");
      await formatting.keyboard.press("Control+Shift+End");
      const editsBefore = await formatting.evaluate(
        () =>
          window.messages.filter((message) => message.type === "edit").length,
      );
      await formatting.keyboard.press("Control+Shift+7");
      assert.equal(
        await sourceSnapshot(formatting, relativePath),
        "1. Parent\n   1. Child\n2. Next",
        "list conversion preserves nested ownership",
      );
      await formatting.locator(".cm-content").focus();
      const undoBefore = await formatting.evaluate(
        () =>
          window.messages.filter((message) => message.type === "undo").length,
      );
      await formatting.keyboard.press("Control+z");
      if (!secondary) {
        // The main editor delegates Undo to the VS Code TextDocument; the
        // synthetic host checks that boundary and returns its document change.
        assert.equal(
          await formatting.evaluate(
            () =>
              window.messages.filter((message) => message.type === "edit")
                .length,
          ),
          editsBefore + 1,
          "one formatting transaction reaches the host",
        );
        assert.equal(
          await formatting.evaluate(
            () =>
              window.messages.filter((message) => message.type === "undo")
                .length,
          ),
          undoBefore + 1,
          "one Undo request reaches the host",
        );
        await post(formatting, {
          type: "external",
          generation: 1,
          changes: [
            {
              from: 0,
              to: "1. Parent\n   1. Child\n2. Next".length,
              insert: nested,
            },
          ],
        });
      }
      assert.equal(await sourceSnapshot(formatting, relativePath), nested);
      assert.equal(
        (await commits(formatting)).length,
        0,
        "formatting/checkboxes never implicitly save",
      );
    }
    await formatting.close();
  }
  passed.push(
    "main/sidebar .md/.note.md: heading/list hotkeys, basic checklist aliases and clickable checkboxes without autosave",
  );
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ passed, errors }, null, 2)}\n`);
} finally {
  await browser.close();
}
