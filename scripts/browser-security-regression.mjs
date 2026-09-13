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
  "# Vault", "", "```aic", "## Main",
  "Password*: example-secret", "Email: alice@example.com", "```", "", "Tail", "",
].join("\n");
const emptySource = source
  .replace("Password*: example-secret", "Password*:")
  .replace("Email: alice@example.com", "Email:");

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

async function ackSave(page, secondary, after) {
  const kind = secondary ? "commit" : "save";
  await page.waitForFunction(({kind, after}) => window.messages.filter(message => message.type === kind).length > after, {kind, after});
  const request = await page.evaluate(kind => window.messages.filter(message => message.type === kind).at(-1), kind);
  await post(page, {...request, type: secondary ? "committed" : "primary.saved", saved: true});
  await page.waitForFunction(() => document.body.dataset.saveState === "saved");
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
    const labelStatus = row.locator(":scope > .cm-aic-security-field-status").first();
    const status = row.locator(":scope > .cm-aic-security-field-status").last();
    assert.equal(await value.textContent(), "••••••••", `${surface}: secret stays masked`);
    assert.doesNotMatch(await page.locator(".cm-aic-security").innerText(), /example-secret/u);

    // Keyboard traversal must never act as Copy.
    await label.focus();
    await page.keyboard.press("Tab");
    assert.equal(await count(page, "clipboard.request"), 0, `${surface}: Tab is navigation only`);

    await label.click();
    const failedCopy = await nextRequest(page, "write");
    assert.equal(failedCopy.text, "Password", `${surface}: label copies the label`);
    assert.doesNotMatch(await status.textContent(), /Copied/u, `${surface}: no optimistic success`);
    await ack(page, failedCopy, false);
    await labelStatus.filter({ hasText: "Copy failed" }).waitFor();
    assert.doesNotMatch(await status.textContent(), /Copied/u);

    await value.click();
    const valueCopy = await nextRequest(page, "write", 1);
    assert.equal(valueCopy.text, "example-secret", `${surface}: value button copies exact value`);
    await ack(page, valueCopy, true);
    await status.filter({ hasText: "Copied" }).waitFor();
    assert.equal(await status.textContent(), "Copied");
    assert.equal(await count(page, "commit"), 0, `${surface}: Copy never saves`);
    assert.equal(await count(page, "save"), 0, `${surface}: Copy never saves`);

    for (const field of ["Password", "Email"]) {
      const filledPaste = page.getByRole("button", { name: `Paste ${field}`, exact: true });
      assert.equal(await filledPaste.count(), 0, `${surface}: filled ${field} Paste absent`);
      assert.equal(await page.getByRole("button", { name: `Delete empty ${field} field`, exact: true }).count(), 0);
      assert.equal(await page.locator(".cm-aic-security-panel").count(), 0);
      assert.equal(await count(page, "clipboard.request"), 2);
      assert.equal(await count(page, "edit"), 0);
    }

    // Empty-field Paste explicitly requests the latest OS clipboard value.
    // Pending read is silent: no replacement prompt or visible panel.
    await init(page, secondary, emptySource);
    const editsBeforePaste = await count(page, "edit");
    const draftsBeforePaste = await count(page, "draft.state");
    await page.getByRole("button", { name: "Paste Password", exact: true }).click();
    const read = await nextRequest(page, "read");
    assert.equal(Object.hasOwn(read, "text"), false, `${surface}: read request carries no value`);
    assert.equal(await page.locator(".cm-aic-security-row .cm-aic-security-field-status").first().textContent(),
      "Pasting…", `${surface}: pending read gives inline status only`);
    assert.equal(await page.locator(".cm-aic-security-panel:visible").count(), 0,
      `${surface}: no visible panel while clipboard read is pending`);
    assert.equal(await page.getByRole("button", { name: "Replace", exact: true }).count(), 0);
    assert.equal(await page.getByRole("button", { name: "Paste latest", exact: true }).count(), 0);
    assert.equal(await count(page, "edit"), editsBeforePaste, `${surface}: no edit before read ACK`);
    assert.equal(await count(page, "draft.state"), draftsBeforePaste,
      `${surface}: no draft change before read ACK`);
    await ack(page, read, true, "latest-secret");
    await page.waitForFunction(({ secondary, edits, drafts }) =>
      window.messages.filter((message) => message.type === (secondary ? "draft.state" : "edit")).length >
        (secondary ? drafts : edits),
    { secondary, edits: editsBeforePaste, drafts: draftsBeforePaste });
    assert.match(await sourceSnapshot(page, "vault.note.md"), /Password\*: latest-secret/u);
    assert.equal(await page.getByRole("button", { name: "Copy Password value", exact: true }).textContent(),
      "••••••••", `${surface}: latest paste remains masked`);
    assert.equal(await page.locator(".cm-aic-security-panel:visible").count(), 0,
      `${surface}: successful read has no visible panel`);
    await ackSave(page, secondary, 0);
    assert.equal(await count(page, secondary ? "commit" : "save"), 1, `${surface}: Paste saves through parent ACK`);
    await page.locator("#pane-pin, .cm-content").first().click();
    assert.equal(await count(page, secondary ? "commit" : "save"), 1, `${surface}: clean blur does not duplicate save`);
    await page.waitForFunction(() => document.body.dataset.readOnly === "false");
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+s");
    await page.waitForFunction((kind) => window.messages.some((message) => message.type === kind),
      secondary ? "commit" : "save");
    const commitsAfterExplicit = await count(page, "commit");
    const savesAfterExplicit = await count(page, "save");

    await init(page, secondary, emptySource);
    await page.getByRole("button", { name: "Paste Password", exact: true }).click();
    const failedRead = await nextRequest(page, "read", 1);
    const editsBeforeFailure = await count(page, "edit");
    await ack(page, failedRead, false);
    const capture = page.locator(".cm-aic-security-paste-capture");
    await capture.waitFor();
    assert.equal(await capture.getAttribute("type"), "password");
    assert.equal(await page.locator(".cm-aic-security-panel:visible").count(), 1,
      `${surface}: fallback capture appears only on read failure`);
    assert.equal(await count(page, "edit"), editsBeforeFailure,
      `${surface}: failed read cannot edit`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(await sourceSnapshot(page, "vault.note.md"), emptySource);
    assert.equal(await count(page, "commit"), commitsAfterExplicit,
      `${surface}: failed read does not commit`);
    assert.equal(await count(page, "save"), savesAfterExplicit,
      `${surface}: failed read does not save`);
    await page.locator("#pane-pin, .cm-content").first().click();
    assert.equal(await count(page, "commit"), commitsAfterExplicit,
      `${surface}: blur after failure does not commit`);
    assert.equal(await count(page, "save"), savesAfterExplicit,
      `${surface}: blur after failure does not save`);

    // A read begun for one note must not hydrate a new note.
    await init(page, secondary, emptySource, "old.note.md");
    await page.getByRole("button", { name: "Paste Password", exact: true }).click();
    const staleRead = await nextRequest(page, "read", 2);
    const newSource = emptySource.replace("# Vault", "# Another");
    await init(page, secondary, newSource, "new.note.md");
    await ack(page, staleRead, true, "late-secret");
    assert.equal(await sourceSnapshot(page, "new.note.md"), newSource);
    assert.doesNotMatch(await page.locator(".cm-aic-security").innerText(), /late-secret/u);
    assert.equal(await page.evaluate(() => window.nativeClipboardCalls), 0,
      `${surface}: only host ACK bridge may access clipboard`);
    passed.push(`${surface}: Copy ACK, filled Paste absent, silent empty-field read, failure fallback, explicit Save, stale-note cancellation`);

    const authenticatorSource = JSON.stringify([
      { service: "https://example.invalid/login", account: "synthetic", secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", password: "DUMMY-IMPORT-PASSWORD" },
      { service: "Example two", account: "synthetic-two", secret: "MZXW6YTB", notes: "Synthetic only" },
    ]);
    await post(page, {
      type: "init", text: authenticatorSource, relativePath: "authenticator.note.md", generation: 0,
      selection: { anchor: authenticatorSource.length, head: authenticatorSource.length },
      ...(secondary ? { placeholder: false, relationships: [] } : {}),
    });
    const convert = page.getByRole("button", { name: "Convert and save security blocks", exact: true });
    await convert.waitFor();
    const importBar = page.getByRole("group", { name: "Authenticator import", exact: true });
    assert.doesNotMatch(await importBar.innerHTML(), /DUMMY-|GEZDGNBV|synthetic/u);
    const editCount = await count(page, "edit");
    const clipboardCount = await count(page, "clipboard.request");
    const commitCount = await count(page, "commit");
    const saveCount = await count(page, "save");
    await convert.click();
    await page.getByRole("button", { name: "Copy Password", exact: true }).waitFor();
    const imported = await sourceSnapshot(page, "authenticator.note.md");
    assert.equal((imported.match(/```aic/gu) || []).length, 1);
    assert.equal((imported.match(/^---$/gmu) || []).length, 1);
    assert.equal(await page.locator(".cm-aic-security-section").count(), 2);
    assert.match(imported, /Password\*: DUMMY-IMPORT-PASSWORD/u);
    assert.match(imported, /TOTP#: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ/u);
    assert.doesNotMatch(await page.locator(".cm-editor").innerHTML(), /DUMMY-IMPORT-PASSWORD|GEZDGNBVGY3TQOJQ/u);
    if (!secondary) assert.equal(await count(page, "edit"), editCount + 1, "main conversion posts one atomic document edit");
    assert.equal(await count(page, "clipboard.request"), clipboardCount);
    await ackSave(page, secondary, secondary ? commitCount : saveCount);
    await page.waitForFunction(() => document.body.dataset.readOnly === "false");
    await page.locator(".cm-content").focus();
    if (secondary) {
      await page.keyboard.press("Control+z");
      await convert.waitFor();
      assert.equal(await sourceSnapshot(page, "authenticator.note.md"), authenticatorSource);
      await page.waitForFunction(() => document.body.dataset.readOnly === "false");
      const beforeReconverting = await count(page, "commit");
      await convert.click();
      await page.waitForFunction(() => document.body.dataset.saveState === "saved");
      assert.equal(await count(page, "commit"), beforeReconverting,
        "reconverting to the exact acknowledged text does not duplicate a save");
    }
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+s");
    await page.waitForFunction(({kind, before}) => window.messages.filter(message => message.type === kind).length > before,
      {kind: secondary ? "commit" : "save", before: secondary ? commitCount : saveCount});
    passed.push(`${surface}: Authenticator array uses shared masked conversion, one edit, no clipboard access and acknowledged Save`);
    await page.close();
  }
  assert.deepEqual(errors, []);
  process.stdout.write(`${JSON.stringify({ passed, errors }, null, 2)}\n`);
} finally {
  await browser.close();
}
