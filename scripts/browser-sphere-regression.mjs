// Production sphere bundle and split chunks in an isolated synthetic webview.
// No VS Code app, workspace files, account or live network access.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const assets = path.resolve(import.meta.dirname, "..", "dist", "webview");
const entry = await readFile(path.join(assets, "sphere.js"), "utf8");
assert.match(entry, /\.\/chunks\//u, "test the split production sphere bundle");

const origin = "http://aic-sphere.test";
const errors = [];
const servedAssets = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 520, height: 720 } });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      errors.push(`unexpected request: ${url.href}`);
      return route.abort();
    }
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><style>
          :root{--vscode-foreground:#ddd;--vscode-panel-border:#555;--vscode-sideBar-background:#222}
          body{margin:0;width:100%;min-height:100vh}
        </style></head><body><main id="sphere"></main><script>
          window.messages=[];window.savedState=null;
          window.acquireVsCodeApi=()=>({getState:()=>window.savedState,
            setState:s=>window.savedState=s,postMessage:m=>window.messages.push(m)});
        </script><script type="module" src="/sphere.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/favicon.ico")
      return route.fulfill({ status: 204, body: "" });
    const file = path.resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${assets}${path.sep}`)) {
      errors.push(`asset path escaped: ${url.pathname}`);
      return route.abort();
    }
    try {
      servedAssets.push(url.pathname);
      return route.fulfill({
        body: await readFile(file),
        contentType: file.endsWith(".js")
          ? "text/javascript"
          : "application/octet-stream",
      });
    } catch (error) {
      errors.push(`missing asset: ${url.pathname} (${error.code})`);
      return route.abort();
    }
  });
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.messages.some((message) => message.type === "ready"),
  );
  assert.ok(
    servedAssets.includes("/sphere.js") &&
      servedAssets.some(
        (asset) => asset.startsWith("/chunks/") && asset.endsWith(".js"),
      ),
    "serve the production entry and its imported chunk",
  );

  const root = page.locator(".aic-context-sphere");
  const orb = page.locator(".aic-context-sphere-orb");
  await root.waitFor({ state: "visible" });
  assert.equal(await root.getAttribute("data-expanded"), "false");
  assert.equal(await orb.getAttribute("aria-label"), "Empty context sphere");
  assert.equal(
    await page.locator(".aic-context-sphere-empty").isVisible(),
    true,
  );
  console.log("PASS empty sphere remains visible");

  const activeId = "file:///project/a.ts";
  const neighborId = "file:///project/b.ts";
  const graph = {
    nodes: [
      {
        id: activeId,
        label: "a.ts",
        path: "project/a.ts",
        kind: "file",
        open: true,
        changed: true,
        dirty: false,
        pinned: false,
        analysis: "ready",
      },
      {
        id: neighborId,
        label: "b.ts",
        path: "project/b.ts",
        kind: "file",
        open: false,
        changed: false,
        dirty: false,
        pinned: false,
        analysis: "ready",
      },
    ],
    edges: [
      {
        id: "import-a-b",
        from: activeId,
        to: neighborId,
        kind: "import",
        label: "./b",
      },
    ],
    activeId,
    limited: false,
  };
  await page.evaluate(
    (value) => window.postMessage({ type: "graph", graph: value }, "*"),
    graph,
  );
  await page.locator(".aic-context-sphere-node").first().waitFor();
  assert.equal(await page.locator(".aic-context-sphere-node").count(), 2);
  assert.equal(await page.locator(".aic-context-sphere-edges line").count(), 1);
  assert.equal(
    await page
      .locator(`.aic-context-sphere-node[data-node-id="${activeId}"]`)
      .getAttribute("data-changed"),
    "true",
  );
  console.log("PASS production graph renders nodes, edge and status");

  await page.locator(".aic-context-sphere-dock").hover();
  await page.waitForFunction(
    () =>
      document.querySelector(".aic-context-sphere")?.dataset.expanded ===
      "true",
  );
  await page.locator(".aic-context-sphere-files summary").click();
  await page
    .locator(
      `.aic-context-sphere-file[data-node-id="${activeId}"] .aic-context-sphere-file-open`,
    )
    .click();
  await page.waitForFunction(
    (id) =>
      window.messages.some(
        (message) => message.type === "open" && message.id === id,
      ),
    activeId,
  );
  await page
    .locator(
      `.aic-context-sphere-file[data-node-id="${activeId}"] .aic-context-sphere-file-pin`,
    )
    .click();
  await page.waitForFunction(
    (id) =>
      window.messages.some(
        (message) =>
          message.type === "pin" &&
          message.id === id &&
          message.pinned === true,
      ),
    activeId,
  );
  console.log(
    "PASS hover expansion, active-node open and explicit pin callbacks",
  );

  const handle = page.locator(".aic-context-sphere-handle");
  const before = await page.evaluate(() => window.savedState?.position);
  const box = await handle.boundingBox();
  assert.ok(box, "drag handle is visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 54,
    box.y + box.height / 2 + 8,
    { steps: 5 },
  );
  await page.mouse.up();
  await page.waitForFunction(
    (previous) => window.savedState?.position?.x > previous.x,
    before,
  );
  assert.ok(
    (await page.evaluate(() => window.savedState.position.x)) > before.x,
  );
  await handle.focus();
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector(".aic-context-sphere")?.dataset.expanded ===
      "false",
  );
  console.log("PASS drag persists position; Escape collapses the sphere");

  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await page.locator(".aic-context-sphere").count(), 0);
  await page.evaluate(
    (value) => window.postMessage({ type: "graph", graph: value }, "*"),
    graph,
  );
  assert.equal(await page.locator(".aic-context-sphere").count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS pagehide disposes the renderer without errors or later updates",
  );
} finally {
  await browser.close();
}
