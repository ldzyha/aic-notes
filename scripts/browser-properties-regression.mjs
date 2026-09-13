// Production VS Code webview bundle with synthetic host messages and note data.
// No extension host, workspace note, OS clipboard, account, or remote request.
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
const origin = "http://aic-properties-webview.test";
const errors = [];
const passed = [];
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});

const source = [
  "---",
  "# Authored comment",
  "file: vault.note.md",
  "created: 2026-09-12T10:00:00Z",
  "updated: 2026-09-12T11:00:00Z",
  "root*: SYNTHETIC-ROOT-SECRET",
  "credentials:",
  "  token*: SYNTHETIC-NESTED-SECRET",
  "empty*: ",
  "---",
  "",
  "# Body remains Markdown",
  "",
  "```aic-security",
  "## Main",
  "Password*: SYNTHETIC-BLOCK-SECRET",
  "```",
].join("\n");

async function openPage(secondary) {
  const page = await browser.newPage({
    viewport: { width: secondary ? 460 : 1100, height: 760 },
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== origin) {
      errors.push(`Unexpected request: ${requestUrl.origin}`);
      return route.abort();
    }
    if (requestUrl.pathname === "/")
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><style>:root{--vscode-editor-background:#191a1b;--vscode-editor-foreground:#bfbfbf;--vscode-sideBar-background:#222324;--vscode-descriptionForeground:#92999f;--vscode-panel-border:#454749;--vscode-textLink-foreground:#45a6c4;--vscode-editorWarning-foreground:#d9a441}</style></head><body class="${secondary ? "aic-secondary-surface" : ""}">${secondary ? scaffold : '<div id="editor"></div>'}<script>window.messages=[];window.savedState=null;window.nativeClipboardCalls=0;Object.defineProperty(navigator,"clipboard",{configurable:true,value:{readText:()=>{window.nativeClipboardCalls++;throw Error("native clipboard used")},writeText:()=>{window.nativeClipboardCalls++;throw Error("native clipboard used")}}});window.acquireVsCodeApi=()=>({getState:()=>window.savedState,setState:s=>window.savedState=s,postMessage:m=>window.messages.push(m)});</script><script type="module" src="/main.js"></script></body></html>`,
      });
    const file = path.resolve(
      assets,
      `.${decodeURIComponent(requestUrl.pathname)}`,
    );
    assert.ok(file.startsWith(`${assets}${path.sep}`));
    return route.fulfill({
      body: await readFile(file),
      contentType: file.endsWith(".js") ? "text/javascript" : "font/woff2",
    });
  });
  await page.goto(origin);
  await page.waitForFunction(() =>
    window.messages.some((message) => message.type === "ready"),
  );
  return page;
}

const post = (page, message) =>
  page.evaluate((payload) => window.postMessage(payload, "*"), message);
const count = (page, type) =>
  page.evaluate(
    (kind) => window.messages.filter((message) => message.type === kind).length,
    type,
  );

async function init(page, secondary, text, relativePath, relationships = []) {
  await post(page, {
    type: "init",
    text,
    relativePath,
    generation: 0,
    selection: { anchor: text.length, head: text.length },
    ...(secondary ? { placeholder: false, relationships } : {}),
  });
  if (secondary)
    await post(page, {
      type: "paneState",
      title: relativePath,
      hasSurface: true,
      hasPlaceholder: false,
      canPin: true,
      canTrash: true,
      canOpenTarget: true,
    });
  await page.locator(".cm-content").waitFor();
}

async function request(page, action, after = 0) {
  await page.waitForFunction(
    ({ action, after }) =>
      window.messages.filter(
        (message) =>
          message.type === "clipboard.request" && message.action === action,
      ).length > after,
    { action, after },
  );
  return page.evaluate(
    (kind) =>
      window.messages
        .filter(
          (message) =>
            message.type === "clipboard.request" && message.action === kind,
        )
        .at(-1),
    action,
  );
}

async function snapshot(page, relativePath) {
  const requestId = `inspect-${Math.random().toString(36).slice(2)}`;
  await post(page, { type: "editing.probe", requestId, relativePath });
  await page.waitForFunction(
    (id) =>
      window.messages.some(
        (message) =>
          message.type === "editing.snapshot" && message.requestId === id,
      ),
    requestId,
  );
  const text = await page.evaluate(
    (id) =>
      window.messages.find(
        (message) =>
          message.type === "editing.snapshot" && message.requestId === id,
      ).text,
    requestId,
  );
  await post(page, { type: "editingState", relativePath, readOnly: false });
  return text;
}

try {
  const sidebar = await openPage(true);
  await init(sidebar, true, source, "vault.note.md", [
    {
      relation: "parent",
      label: "Synthetic parent",
      path: "Parent.note.md",
      depth: 1,
      exists: true,
    },
  ]);
  const card = sidebar.locator(".cm-aic-properties");
  await card.waitFor();
  assert.equal(
    await sidebar.locator(".cm-aic-security:not(.cm-aic-properties)").count(),
    1,
  );
  const markup = await card.evaluate((element) => element.outerHTML);
  assert.doesNotMatch(markup, /SYNTHETIC-(ROOT|NESTED)-SECRET/u);
  assert.equal(
    await card.getByRole("button", { name: "Copy root value" }).textContent(),
    "••••••••",
  );
  assert.equal(
    await card.getByRole("button", { name: "Copy token value" }).textContent(),
    "••••••••",
  );
  for (const name of ["file", "created", "updated"]) {
    assert.equal(
      await card.getByRole("button", { name: `Paste ${name}` }).count(),
      0,
    );
    assert.equal(
      await card
        .getByRole("button", { name: `Delete empty ${name} field` })
        .count(),
      0,
    );
  }
  await card.getByRole("button", { name: "Copy created value" }).click();
  const copied = await request(sidebar, "write");
  assert.equal(copied.text, "2026-09-12T10:00:00Z");
  await post(sidebar, {
    type: "clipboard.response",
    requestId: copied.requestId,
    ok: true,
  });
  assert.equal(await count(sidebar, "commit"), 0, "copy must not save");

  const sections = card.locator(".cm-aic-security-section");
  const tree = card.locator(".cm-aic-note-relations");
  assert.ok(await tree.count());
  assert.equal(
    await card.evaluate((element) => {
      const first = element.querySelector(".cm-aic-security-section");
      const related = element.querySelector(".cm-aic-note-relations");
      const next = first?.nextElementSibling;
      return next === related;
    }),
    true,
    "related tree follows managed metadata",
  );
  assert.ok(await sections.count());
  await tree
    .getByRole("button", { name: "Open parent note Synthetic parent" })
    .click();
  await sidebar.waitForFunction(() =>
    window.messages.some(
      (message) => message.type === "bus" && message.topic === "note.open",
    ),
  );
  const navigation = await sidebar.evaluate(() =>
    window.messages
      .filter(
        (message) => message.type === "bus" && message.topic === "note.open",
      )
      .at(-1),
  );
  assert.deepEqual(navigation.payload, { path: "Parent.note.md" });
  assert.equal(
    await count(sidebar, "commit"),
    0,
    "navigation must not edit or save",
  );

  await card.getByRole("button", { name: "Paste empty" }).click();
  const read = await request(sidebar, "read");
  assert.equal(Object.hasOwn(read, "text"), false);
  await post(sidebar, {
    type: "clipboard.response",
    requestId: read.requestId,
    ok: true,
    text: "SYNTHETIC-PASTE",
  });
  await sidebar.waitForFunction(() =>
    window.messages.some((message) => message.type === "commit"),
  );
  const changed = await snapshot(sidebar, "vault.note.md");
  assert.match(changed, /empty\*: "SYNTHETIC-PASTE"/u);
  assert.ok(changed.includes("# Authored comment"));
  assert.ok(
    changed.endsWith(
      "# Body remains Markdown\n\n```aic-security\n## Main\nPassword*: SYNTHETIC-BLOCK-SECRET\n```",
    ),
  );
  assert.doesNotMatch(
    await sidebar
      .locator(".cm-aic-properties")
      .evaluate((element) => element.outerHTML),
    /SYNTHETIC-PASTE/u,
  );
  assert.equal(
    await count(sidebar, "commit"),
    1,
    "one preview mutation requests one save boundary",
  );
  assert.equal(await sidebar.evaluate(() => window.nativeClipboardCalls), 0);
  passed.push(
    "secondary: masked root/nested Properties, immutable metadata, read-only related navigation, host Paste and save boundary",
  );
  await sidebar.close();

  const main = await openPage(false);
  const ordinary = "# Ordinary Markdown\n\nBody\n\n---\n\nTail";
  await init(main, false, ordinary, "ordinary.md");
  assert.equal(await main.locator(".cm-aic-properties").count(), 0);
  assert.equal(await snapshot(main, "ordinary.md"), ordinary);
  assert.equal(await count(main, "edit"), 0);
  assert.equal(await count(main, "save"), 0);
  passed.push("main ordinary .md: no generated Properties or edit/save");
  await main.close();

  // Shared group controls and one-shot source mode must work in both surfaces,
  // not merely in an isolated Security renderer.
  for (const secondary of [true, false]) {
    const page = await openPage(secondary);
    const text = source.replace("empty*: ", "Email: public@example.test\nempty*: ");
    await init(page, secondary, text, "grouped.note.md");
    const properties = page.locator(".cm-aic-properties");
    const filter = properties.getByRole("searchbox", { name: "Filter fields and groups" });
    await filter.fill("SYNTHETIC-ROOT-SECRET");
    assert.equal(await properties.locator('.cm-aic-security-section:not([hidden])').count(), 1, "managed metadata remains visible but secret is not searched");
    await filter.fill("Email");
    assert.equal(await properties.getByRole("button", { name: "Copy Email value", exact: true }).isVisible(), true);
    assert.equal(await snapshot(page, "grouped.note.md"), text);
    assert.equal(await count(page, "edit"), 0);
    assert.equal(await count(page, secondary ? "commit" : "save"), 0);
    await properties.getByRole("button", { name: "Clear filter" }).click();
    await properties.getByRole("button", { name: "Add field to Fields" }).click();
    assert.equal(await properties.getByRole("button", { name: "Add Password", exact: true }).isVisible(), true);
    await page.keyboard.press("Escape");
    assert.equal(await properties.getByRole("button", { name: "Add Password", exact: true }).isVisible(), false);

    await page.getByRole("button", { name: "Show Markdown source", exact: true }).click();
    assert.equal(await page.locator(".cm-aic-security").count(), 0, "source mode removes both card renderers");
    assert.ok((await page.locator(".cm-content").textContent()).includes("SYNTHETIC-ROOT-SECRET"), "explicit source editing exposes original Markdown, not another document");
    assert.equal(await snapshot(page, "grouped.note.md"), text);
    assert.equal(await count(page, "edit"), 0);
    assert.equal(await count(page, secondary ? "commit" : "save"), 0);
    assert.equal(await count(page, "source.open"), 0, "mode button never opens native editor");

    await post(page, { type: "external", relativePath: "grouped.note.md", generation: 1, changes: [{ from: text.length, insert: "\nRemote text" }] });
    assert.equal(await snapshot(page, "grouped.note.md"), text + "\nRemote text");
    assert.equal(await page.getByRole("button", { name: "Show preview", exact: true }).count(), 1, "same-note host update retains temporary mode");
    await post(page, { type: "reset", generation: 2, text });
    assert.equal(await snapshot(page, "grouped.note.md"), text);
    assert.equal(await page.getByRole("button", { name: "Show preview", exact: true }).count(), 1, "same-note reset retains temporary mode");
    await page.getByRole("button", { name: "Show preview", exact: true }).click();
    await properties.waitFor();
    assert.doesNotMatch(await properties.textContent(), /SYNTHETIC-ROOT-SECRET/u);
    await page.getByRole("button", { name: "Show Markdown source", exact: true }).click();
    await init(page, secondary, text, "different.note.md");
    await properties.waitFor();
    assert.equal(await page.getByRole("button", { name: "Show Markdown source", exact: true }).count(), 1, "another note always starts in preview");
    assert.equal(await page.evaluate(() => window.nativeClipboardCalls), 0);
    passed.push(`${secondary ? "secondary" : "main"}: common filter/add menu, transient source toggle, exact source and identity reset without edits/save/native mode`);
    await page.close();
  }
  for (const secondary of [true, false]) {
    const page = await openPage(secondary);
    const text = "---\n# aic-fields: v2\nfile: payment.note.md\nCard_: '4242 4242 4242 4242 | 09/28 | '\nCorporate#: 'JBSWY3DPEHPK3PXP | Work'\n---\nBody";
    await init(page, secondary, text, "payment.note.md");
    const props = page.locator(".cm-aic-properties");
    await props.waitFor();
    assert.doesNotMatch(await props.innerHTML(), /JBSWY3DPEHPK3PXP|aic-fields/u);
    await props.getByRole("button", { name: "Copy Card number value", exact: true }).click();
    const copied = await request(page, "write");
    assert.equal(copied.text, "4242 4242 4242 4242");
    await post(page, { type: "clipboard.response", requestId: copied.requestId, ok: true });
    await props.getByRole("button", { name: "Paste Card cvv", exact: true }).click();
    const pasted = await request(page, "read");
    await post(page, { type: "clipboard.response", requestId: pasted.requestId, ok: true, text: "739" });
    await page.waitForFunction(() => !document.querySelector('[aria-label="Paste Card cvv"]'));
    const saved = await snapshot(page, "payment.note.md");
    assert.ok(saved.startsWith("---\n# aic-fields: v2\n"));
    assert.ok(saved.includes("09/28 | 739"));
    assert.doesNotMatch(await props.innerHTML(), /739|JBSWY3DPEHPK3PXP/u);
    assert.equal(await count(page, secondary ? "commit" : "save"), 1);
    await init(page, secondary, saved, "reopened.note.md");
    await props.getByRole("button", { name: "Copy Card cvv value", exact: true }).click();
    const cvv = await request(page, "write", 1);
    assert.equal(cvv.text, "739");
    await post(page, { type: "clipboard.response", requestId: cvv.requestId, ok: true });
    assert.equal(await page.evaluate(() => window.nativeClipboardCalls), 0);
    passed.push(`${secondary ? "secondary" : "main"}: activated v2 Properties, independent card copy, empty CVV Paste/save and masked reopen`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await browser.close();
}
