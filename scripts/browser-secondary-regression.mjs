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
  page.on("pageerror", (error) => {
    errors.push(error.message);
    process.stderr.write(`${error.stack}\n`);
  });
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
  "# Project\n\n```aic\n# Account\nService | Example\nPassword *| synthetic-secret\n```\n\nWrite here.";
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
  // init restores focus on the next animation frame. Typing before that frame
  // tests scheduler timing rather than the production editor input contract.
  await page.waitForFunction(() =>
    document.activeElement?.classList.contains("cm-content"),
  );
}
try {
  const insertionPage = await openPage();
  await init(insertionPage, source, true);
  const reference = {
    label: "file.js:1",
    href: "file.js#L1",
    markdown: "[file.js:1](file.js#L1)",
    compactMarkdown: "[file.js · L1](file.js#L1)",
  };
  await post(insertionPage, {
    type: "linkedCode.insert",
    requestId: "test-insert",
    expiresAt: Date.now() + 5000,
    relativePath: "Project.note.md",
    generation: 0,
    reference,
    selectedText: "const example = 1;",
  });
  await state(insertionPage, "dirty");
  assert.equal((await commits(insertionPage)).length, 0);
  const inserted = await sourceSnapshot(insertionPage, "Project.note.md");
  assert.ok(inserted.startsWith(source));
  assert.ok(inserted.includes("const example = 1;"));
  assert.ok(inserted.includes("**Comment**"));
  assert.equal(
    await insertionPage.evaluate(
      () =>
        window.messages.find(
          (message) =>
            message.requestId === "test-insert" &&
            message.type === "linkedCode.result",
        ).accepted,
    ),
    true,
  );
  await post(insertionPage, {
    type: "linkedCode.insert",
    requestId: "expired",
    expiresAt: 1,
    relativePath: "Project.note.md",
    generation: 0,
    reference,
    selectedText: "MUST NOT INSERT",
  });
  assert.equal(
    await sourceSnapshot(insertionPage, "Project.note.md"),
    inserted,
  );
  await insertionPage.close();
  passed.push(
    "linked-code insertion edits the live placeholder without saving; expired intents are rejected",
  );
  for (const theme of ["dark", "light"]) {
    const page = await openPage({ theme });
    await init(page);
    await state(page, "saved");
    const sourceToggle = page.getByRole("button", {
      name: "Show Markdown source",
      exact: true,
    });
    const linkedSource = page.getByRole("button", {
      name: "Open linked source file",
      exact: true,
    });
    assert.equal(await sourceToggle.getAttribute("data-aic-icon"), "source");
    assert.equal(await linkedSource.getAttribute("data-aic-icon"), "open");
    assert.equal(await sourceToggle.count(), 1);
    assert.equal(await linkedSource.count(), 1);
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
    const properties = page.locator(".cm-aic-security:not(.cm-aic-properties)");
    assert.equal(
      await properties.count(),
      1,
      "one AIC preview, without duplicate chrome",
    );
    assert.deepEqual(
      await properties.evaluate((card) => {
        const metadata = card.querySelector(".cm-aic-properties-metadata");
        const tree = card.querySelector(".cm-aic-note-relations");
        const custom = card.querySelector(".cm-aic-security-body");
        return {
          dates: card.querySelectorAll(".cm-aic-properties-date").length,
          metadataBeforeTree: Boolean(
            metadata &&
            tree &&
            metadata.compareDocumentPosition(tree) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          treeBeforeCustom: Boolean(
            tree &&
            custom &&
            tree.compareDocumentPosition(custom) &
              Node.DOCUMENT_POSITION_FOLLOWING,
          ),
          currentProject: tree?.querySelector(
            '[aria-current="true"] .cm-aic-note-relation-label',
          )?.textContent,
          hasContextHeading: Boolean(
            card.querySelector(".cm-aic-note-relations-heading"),
          ),
          hasFilename: card.textContent.includes("Project.note.md"),
          customRows: custom?.querySelectorAll(".cm-aic-security-row").length,
          customFilter: Boolean(
            custom?.querySelector(".cm-aic-security-filter"),
          ),
        };
      }),
      {
        dates: 0,
        metadataBeforeTree: false,
        treeBeforeCustom: true,
        currentProject: "Project",
        hasContextHeading: false,
        hasFilename: false,
        customRows: 2,
        customFilter: false,
      },
      "the current-note tree and AIC rows render without managed dates",
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
    assert.equal(
      (await commits(page)).length,
      0,
      "input and focus changes within the editor surface do not save",
    );
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForFunction(() =>
      window.messages.some((message) => message.type === "commit"),
    );
    assert.equal(
      (await commits(page)).length,
      1,
      "leaving the editor surface requests one save",
    );
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() =>
      window.messages.some((m) => m.type === "commit"),
    );
    const first = (await commits(page)).at(-1);
    await post(page, {
      ...first,
      type: "committed",
      saved: true,
      text: first.text,
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
  await init(page, source, false, "Project.note.md");
  assert.equal(
    await page
      .getByRole("button", { name: "Show Markdown source", exact: true })
      .count(),
    1,
    "the primary surface owns one in-place source toggle",
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Open linked source file", exact: true })
      .count(),
    0,
    "linked-owner navigation is Secondary-only",
  );
  assert.equal(await page.locator(".cm-aic-properties-date").count(), 0);
  passed.push(
    "primary/secondary actions: one source toggle, distinct linked-source navigation, no date rows",
  );
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
    await page.locator(".cm-md-mermaid-editing svg").waitFor();
    assert.equal(await page.locator(".aic-diagram-builder").count(), 0);
    const selection = await page.evaluate(() => window.savedState);
    assert.equal(selection.anchor, anchor);
    assert.equal(selection.head, anchor);
  }
  passed.push(
    "class and sequence source retain live Mermaid previews and selection",
  );

  const narrow = await openPage({ width: 300 });
  const legacyFlow = [
    "flowchart LR",
    '    A["Input or central question"] --> B["Owned decision or process"]',
    '    B --> C["Outcome or consumer"]',
    '    B -. "Failure or optional path" .-> D["Recovery or omission"]',
  ].join("\n");
  const flowNote = `# Diagram\n\n\`\`\`mermaid\n${legacyFlow}\n\`\`\`\n\n`;
  await init(narrow, flowNote);
  const preview = narrow.locator(".cm-md-mermaid:visible").first();
  await preview.locator("svg").waitFor();
  assert.equal(
    await preview.getByRole("button", { name: "Edit Mermaid source" }).count(),
    1,
  );
  assert.equal(
    await preview.getByRole("button", { name: "Copy Mermaid source" }).count(),
    1,
  );
  assert.equal(
    await preview.getByRole("button", { name: /Rotate diagram/u }).count(),
    0,
  );
  await preview.getByRole("button", { name: "Copy Mermaid source" }).click();
  assert.equal(
    await narrow.evaluate(
      () =>
        window.messages
          .filter((message) => message.topic === "clipboard.write")
          .at(-1)?.payload.text,
    ),
    legacyFlow,
  );
  const stage = preview.locator(".cm-aic-mermaid-stage");
  const originalWidth = await stage.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  await preview.getByRole("button", { name: "Zoom in" }).click();
  const zoomedWidth = await stage.evaluate(
    (node) => node.getBoundingClientRect().width,
  );
  assert.ok(
    zoomedWidth > originalWidth,
    "zoom enlarges only the preview diagram",
  );
  await preview.getByRole("button", { name: "Edit Mermaid source" }).click();
  await narrow.locator(".cm-md-mermaid-editing svg").waitFor();
  assert.equal(await narrow.locator(".aic-diagram-builder").count(), 0);
  assert.equal(await sourceSnapshot(narrow, "Project.note.md"), flowNote);
  passed.push(
    "narrow flowchart: Copy, one Edit, preview zoom, live source preview, no builder or rotation",
  );
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
