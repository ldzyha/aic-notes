// Production webview bundle, synthetic VS Code host and note content only.
// No extension host, real notes, OS clipboard, account, or remote requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "dist", "webview");
const provider = await readFile(path.join(root, "src/secondary/provider.js"), "utf8");
const scaffold = provider.match(/`(<span id="pane-status"[\s\S]*?<\/footer>)`/u)?.[1];
assert.ok(scaffold, "use the production Secondary HTML scaffold");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const origin = "http://aic-security-webview.test";
const errors = [];
const passed = [];
const source = [
  "# Vault", "", "```aic-security", "## Main",
  "Password*: example-secret", "Email: alice@example.com", "```", "", "Tail", "",
].join("\n");

async function openPage(secondary) {
  const page = await browser.newPage({ viewport: { width: secondary ? 460 : 1100, height: 720 } });
  page.setDefaultTimeout(6000);
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
        body: `<!doctype html><html><head><style>:root{--vscode-editor-background:#191a1b;--vscode-editor-foreground:#bfbfbf;--vscode-sideBar-background:#222324;--vscode-descriptionForeground:#92999f;--vscode-panel-border:#454749;--vscode-textLink-foreground:#45a6c4;--vscode-editorWarning-foreground:#d9a441}</style></head><body class="${secondary ? "aic-secondary-surface" : ""}">${secondary ? scaffold : '<div id="editor"></div>'}<script>window.messages=[];window.savedState=null;window.nativeClipboardCalls=0;Object.defineProperty(navigator,"clipboard",{configurable:true,value:{readText:()=>{window.nativeClipboardCalls++;throw Error("native clipboard used")},writeText:()=>{window.nativeClipboardCalls++;throw Error("native clipboard used")}}});window.acquireVsCodeApi=()=>({getState:()=>window.savedState,setState:s=>window.savedState=s,postMessage:m=>window.messages.push(m)});</script><script type="module" src="/main.js"></script></body></html>`,
      });
    }
    const file = path.resolve(assets, `.${decodeURIComponent(url.pathname)}`);
    assert.ok(file.startsWith(`${assets}${path.sep}`));
    return route.fulfill({
      body: await readFile(file),
      contentType: file.endsWith(".js") ? "text/javascript" : "font/woff2",
    });
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.messages.some((message) => message.type === "ready"));
  return page;
}

const post = (page, message) => page.evaluate((payload) => {
  window.postMessage(payload, "*");
}, message);

async function init(page, secondary, text = source, relativePath = "vault.note.md") {
  await post(page, {
    type: "init", text, relativePath, generation: 0,
    selection: { anchor: text.length, head: text.length },
    ...(secondary ? { placeholder: false, relationships: [] } : {}),
  });
  if (secondary) await post(page, {
    type: "paneState", title: relativePath, hasSurface: true,
    hasPlaceholder: false, canPin: true, canTrash: true, canOpenTarget: true,
  });
  await page.locator('.cm-aic-security-row button[aria-label="Copy Password"]').waitFor();
}

async function nextRequest(page, action, after = 0) {
  await page.waitForFunction(({ action, after }) =>
    window.messages.filter((message) =>
      message.type === "clipboard.request" && message.action === action).length > after,
  { action, after });
  return page.evaluate((kind) => window.messages.filter((message) =>
    message.type === "clipboard.request" && message.action === kind).at(-1), action);
}

const count = (page, type) => page.evaluate((kind) =>
  window.messages.filter((message) => message.type === kind).length, type);

async function sourceSnapshot(page, relativePath) {
  const requestId = `inspect-${Math.random().toString(36).slice(2)}`;
  await post(page, { type: "editing.probe", requestId, relativePath });
  await page.waitForFunction((id) => window.messages.some((message) =>
    message.type === "editing.snapshot" && message.requestId === id), requestId);
  const snapshot = await page.evaluate((id) => window.messages.find((message) =>
    message.type === "editing.snapshot" && message.requestId === id).text, requestId);
  await post(page, { type: "editingState", relativePath, readOnly: false });
  return snapshot;
}

async function ack(page, request, ok, text) {
  await post(page, {
    type: "clipboard.response", requestId: request.requestId, ok,
    ...(!ok ? { error: "unavailable" } : request.action === "read" ? { text } : {}),
  });
}

try {
  for (const secondary of [false, true]) {
    const surface = secondary ? "sidebar" : "main";
    const page = await openPage(secondary);
    await init(page, secondary);
    const row = page.locator(".cm-aic-security-row").filter({
      has: page.getByRole("button", { name: "Copy Password", exact: true }),
    });
    const label = row.getByRole("button", { name: "Copy Password", exact: true });
    const value = row.getByRole("button", { name: "Copy Password value", exact: true });
    const status = row.locator(".cm-aic-security-field-status");
    assert.equal(await value.textContent(), "••••••••", `${surface}: secret stays masked`);
    assert.doesNotMatch(await page.locator(".cm-aic-security").innerText(), /example-secret/u);

    // Keyboard traversal must never act as Copy.
    await label.focus();
    await page.keyboard.press("Tab");
    assert.equal(await count(page, "clipboard.request"), 0, `${surface}: Tab is navigation only`);

    await label.click();
    const failedCopy = await nextRequest(page, "write");
    assert.equal(failedCopy.text, "example-secret", `${surface}: label copies the exact value`);
    assert.doesNotMatch(await status.textContent(), /Copied/u, `${surface}: no optimistic success`);
    await ack(page, failedCopy, false);
    await page.waitForFunction(() => document.querySelector(".cm-aic-security-row .cm-aic-security-field-status")?.textContent === "Copy failed");
    assert.doesNotMatch(await status.textContent(), /Copied/u);

    await value.click();
    const valueCopy = await nextRequest(page, "write", 1);
    assert.equal(valueCopy.text, "example-secret", `${surface}: value button copies exact value`);
    await ack(page, valueCopy, true);
    await page.waitForFunction(() => document.querySelector(".cm-aic-security-row .cm-aic-security-field-status")?.textContent === "Copied");
    assert.equal(await status.textContent(), "Copied");
    assert.equal(await count(page, "commit"), 0, `${surface}: Copy never saves`);
    assert.equal(await count(page, "save"), 0, `${surface}: Copy never saves`);

    const paste = row.getByRole("button", { name: "Paste Password", exact: true });
    await paste.click();
    await page.locator(".cm-aic-security-panel").waitFor();
    assert.equal(await count(page, "clipboard.request"), 2, `${surface}: opening Replace does not read`);
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    const read = await nextRequest(page, "read");
    assert.equal(Object.hasOwn(read, "text"), false, `${surface}: read request carries no secret`);
    assert.equal(await count(page, "edit"), 0, `${surface}: no edit before read ACK`);
    assert.equal(await count(page, "commit"), 0, `${surface}: no commit before read ACK`);
    await ack(page, read, true, "new-secret");
    await page.waitForFunction(() => window.messages.some((message) =>
      message.type === "edit" || (message.type === "draft.state" && message.dirty)));
    assert.match(await sourceSnapshot(page, "vault.note.md"), /Password\*: new-secret/u);
    const updatedValue = page.getByRole("button", { name: "Copy Password value", exact: true });
    if (await updatedValue.count()) assert.equal(await updatedValue.textContent(), "••••••••");
    const editsAfterPaste = await count(page, "edit");
    await page.getByRole("button", { name: "Paste Password", exact: true }).click();
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    const failedRead = await nextRequest(page, "read", 1);
    await ack(page, failedRead, false);
    await page.locator(".cm-aic-security-paste-capture").waitFor();
    assert.doesNotMatch(await page.locator(".cm-aic-security-panel").innerText(), /Pasted/u,
      `${surface}: failed read has no false success`);
    assert.equal(await count(page, "edit"), editsAfterPaste, `${surface}: failed read cannot edit`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.match(await sourceSnapshot(page, "vault.note.md"), /Password\*: new-secret/u);
    assert.equal(await count(page, "commit"), 0, `${surface}: Paste edit does not commit`);
    assert.equal(await count(page, "save"), 0, `${surface}: Paste edit does not save`);
    await page.locator("#pane-pin, .cm-content").first().click();
    assert.equal(await count(page, "commit"), 0, `${surface}: blur does not commit`);
    assert.equal(await count(page, "save"), 0, `${surface}: blur does not save`);
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+s");
    await page.waitForFunction((kind) => window.messages.some((message) => message.type === kind),
      secondary ? "commit" : "save");

    // A read begun for one note must not hydrate a newly initialized note.
    await init(page, secondary, source, "old.note.md");
    await page.getByRole("button", { name: "Paste Password", exact: true }).click();
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    const staleRead = await nextRequest(page, "read", 1);
    await init(page, secondary, source.replace("example-secret", "other-secret"), "new.note.md");
    await ack(page, staleRead, true, "late-secret");
    assert.equal(await sourceSnapshot(page, "new.note.md"), source.replace("example-secret", "other-secret"));
    assert.doesNotMatch(await page.locator(".cm-aic-security").innerText(), /late-secret/u);
    assert.equal(await page.evaluate(() => window.nativeClipboardCalls), 0,
      `${surface}: only host ACK bridge may access clipboard`);
    passed.push(`${surface}: label/value Copy ACK, masked Paste, explicit Save, stale-note cancellation`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ passed, errors }, null, 2)}\n`);
} finally {
  await browser.close();
}
