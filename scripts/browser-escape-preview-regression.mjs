// Synthetic production-webview Escape smoke for both editor surfaces.
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
assert.ok(scaffold);
const origin = "http://aic-escape-webview.test";
const errors = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});

async function openPage(secondary) {
  const page = await browser.newPage({
    viewport: { width: secondary ? 460 : 1100, height: 720 },
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      errors.push(`Unexpected request: ${url.origin}`);
      return route.abort();
    }
    if (url.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>:root{--vscode-editor-background:#191a1b;--vscode-editor-foreground:#bfbfbf;--vscode-sideBar-background:#222324;--vscode-descriptionForeground:#92999f;--vscode-panel-border:#454749;--vscode-textLink-foreground:#45a6c4}</style></head><body class="${secondary ? "aic-secondary-surface" : ""}">${secondary ? scaffold : '<div id="editor"></div>'}<script>window.messages=[];window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:m=>window.messages.push(m)});</script><script type="module" src="/main.js"></script></body></html>`,
      });
    const file = path.resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    assert.ok(file.startsWith(`${assets}${path.sep}`));
    return route.fulfill({
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

async function init(page, secondary, text, pathName) {
  await page.evaluate((message) => window.postMessage(message, "*"), {
    type: "init",
    text,
    relativePath: pathName,
    generation: 0,
    selection: { anchor: text.length, head: text.length },
    ...(secondary ? { placeholder: false, relationships: [] } : {}),
  });
}

const cases = [
  {
    name: "code",
    text: "Before\n\n```ts\nconst answer = 42;\n```\n\nAfter",
    edit: "Edit code source",
    preview: ".cm-md-code-preview",
    copy: "Copy code",
    copiedText: "const answer = 42;",
  },
  {
    name: "table",
    text: "Before\n\nA | B\n--- | ---\nx | y\n\nAfter",
    edit: "Edit table source",
    preview: ".cm-md-table",
    copy: "Copy table",
    copiedText: "A | B\n--- | ---\nx | y",
  },
  {
    name: "details",
    text: "Before\n\n>>> Detail\nbody\n<<<\n\nAfter",
    edit: "Edit details source",
    preview: ".cm-aic-details-summary",
  },
  {
    name: "security",
    text: "Before\n\n```aic\n# Synthetic card\n## Main\nPassword*: synthetic-secret | note\n```\n\nAfter",
    edit: "Edit security block",
    preview: ".cm-aic-security",
  },
  {
    name: "properties",
    text: "---\nfile: synthetic.note.md\nstatus: idea\n---\n\nAfter",
    edit: "Edit properties",
    preview: ".cm-aic-properties",
  },
  {
    name: "Mermaid",
    text: "Before\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\nAfter",
    edit: "Edit Mermaid source",
    preview: '.cm-md-mermaid[aria-label="Mermaid diagram preview"]',
    copy: "Copy Mermaid source",
    copiedText: "flowchart LR\n  A --> B",
  },
];

try {
  for (const secondary of [false, true]) {
    for (const theme of ["vscode-dark", "vscode-light"]) {
      for (const item of cases) {
        const page = await openPage(secondary);
        await page.evaluate((name) => document.body.classList.add(name), theme);
        await init(page, secondary, item.text, `${item.name.toLowerCase()}.md`);
        const preview = page.locator(item.preview);
        await preview.waitFor();
        await page
          .getByRole("button", { name: item.edit, exact: true })
          .click();
        assert.equal(await preview.count(), 0, `${item.name}: source opened`);
        await page.keyboard.press("Escape");
        await preview.waitFor();
        if (item.copy) {
          await page
            .getByRole("button", { name: item.copy, exact: true })
            .click();
          const copied = await page.evaluate(() =>
            window.messages.findLast(
              (message) =>
                message.type === "bus" && message.topic === "clipboard.write",
            ),
          );
          assert.equal(copied?.payload?.text, item.copiedText);
        }
        assert.equal(
          await page.evaluate(
            () =>
              window.messages.filter((m) =>
                ["edit", "save", "commit"].includes(m.type),
              ).length,
          ),
          0,
          `${item.name}: Escape does not edit or save`,
        );
        await page.close();
      }

      const page = await openPage(secondary);
      await page.evaluate((name) => document.body.classList.add(name), theme);
      const text = cases[0].text;
      await init(page, secondary, text, "whole-source.md");
      await page.locator(".cm-md-code-preview").waitFor();
      await page.getByRole("button", { name: "Show Markdown source" }).click();
      await page
        .locator(".cm-line")
        .filter({ hasText: "const answer" })
        .click();
      await page.keyboard.press("Escape");
      await page.locator(".cm-md-code-preview").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Show Markdown source" })
          .count(),
        1,
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.messages.filter((m) =>
              ["edit", "save", "commit"].includes(m.type),
            ).length,
        ),
        0,
      );
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  console.log(
    "Escape preview: six block types, source mode and copy/no-save pass in both surfaces and themes",
  );
} finally {
  await browser.close();
}
