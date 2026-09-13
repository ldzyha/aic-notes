// Production primary/sidebar bundle with synthetic host acknowledgements only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AIC_REVIEW_PLAYWRIGHT || "playwright");
const assets = path.resolve(import.meta.dirname, "../dist/webview");
const provider = await readFile(
  new URL("../src/secondary/provider.js", import.meta.url),
  "utf8",
);
const scaffold = provider.match(
  /`(<span id="pane-status"[\s\S]*?<\/footer>)`/u,
)?.[1];
assert.ok(scaffold);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AIC_REVIEW_BROWSER
    ? { executablePath: process.env.AIC_REVIEW_BROWSER }
    : {}),
});
const errors = [];
const origin = "http://aic-save.test";
try {
  for (const secondary of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: 490, height: 790 },
    });
    page.setDefaultTimeout(6000);
    page.on("pageerror", (error) => {
      errors.push(error.message);
      console.error(error.message);
    });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin);
      if (url.pathname === "/")
        return route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><body class="${secondary ? "aic-secondary-surface" : ""}">${secondary ? scaffold : '<div id="editor"></div>'}<script>window.messages=[];window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:message=>window.messages.push(message)});</script><script type="module" src="/main.js"></script></body></html>`,
        });
      const file = path.resolve(assets, "." + url.pathname);
      assert.ok(file.startsWith(assets + path.sep));
      return route.fulfill({
        body: await readFile(file),
        contentType: file.endsWith(".js") ? "text/javascript" : "font/woff2",
      });
    });
    await page.goto(origin);
    await page.waitForFunction(() =>
      window.messages.some((message) => message.type === "ready"),
    );
    const post = (message) =>
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
        message,
      );
    const kind = secondary ? "commit" : "save";
    const requests = () =>
      page.evaluate(
        (kind) => window.messages.filter((message) => message.type === kind),
        kind,
      );
    const waitCount = (count) =>
      page.waitForFunction(
        ({ kind, count }) =>
          window.messages.filter((message) => message.type === kind).length ===
          count,
        { kind, count },
      );
    const init = async (text, relativePath = "fixture.note.md") => {
      await post({
        type: "init",
        text,
        relativePath,
        generation: 0,
        placeholder: false,
        selection: { anchor: text.length, head: text.length },
      });
      await page.locator(".cm-content").waitFor();
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains("cm-content"),
      );
    };
    const acknowledge = async (request, saved = true) => {
      await post({
        ...request,
        type: secondary ? "committed" : "primary.saved",
        saved,
      });
    };
    await init("# Synthetic\n\nText");
    await page.keyboard.insertText(" first");
    assert.equal((await requests()).length, 0, "ordinary input does not save");
    await page.locator("#aic-save").click();
    await waitCount(1);
    const first = (await requests())[0];
    assert.equal(
      await page.evaluate(() => document.body.dataset.saveState),
      "dirty",
    );
    await page.locator(".cm-content").focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" newer");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    assert.equal(
      (await requests()).length,
      1,
      "newer boundary queues behind pending save",
    );
    await acknowledge(first);
    await waitCount(2);
    const second = (await requests())[1];
    assert.ok(second.text.endsWith(" first newer"));
    await acknowledge(second);
    await page.waitForFunction(
      () => document.body.dataset.saveState === "saved",
    );
    await page.keyboard.insertText(" retry");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await waitCount(3);
    await acknowledge((await requests())[2], false);
    await page.waitForFunction(
      () => !document.getElementById("aic-save").disabled,
    );
    assert.equal(
      await page.evaluate(() => document.body.dataset.saveState),
      "dirty",
    );
    await page.keyboard.press("Control+s");
    await waitCount(4);
    await acknowledge((await requests())[3]);
    await page.waitForFunction(
      () => document.body.dataset.saveState === "saved",
    );

    await init("```aic\n##\nPassword*:\n```\n");
    await page.getByRole("button", { name: "Add Email", exact: true }).click();
    await waitCount(5);
    await acknowledge((await requests())[4]);
    await page.waitForFunction(
      () => document.body.dataset.saveState === "saved",
    );
    await init(
      JSON.stringify([
        { service: "Fixture", account: "fixture-account", secret: "" },
      ]),
    );
    await page
      .getByRole("button", {
        name: "Convert and save security blocks",
        exact: true,
      })
      .click();
    await waitCount(6);
    assert.match(
      await page.locator(".cm-aic-security-import-guidance").innerText(),
      /Saving/u,
    );
    await acknowledge((await requests())[5]);
    await page.waitForFunction(
      () => document.body.dataset.saveState === "saved",
    );
    await page.getByText("Note saved", { exact: true }).last().waitFor();

    await page.getByRole("button", { name: "Add Email", exact: true }).click();
    await waitCount(7);
    const old = (await requests())[6];
    await init("# Other", "other.note.md");
    await page.keyboard.insertText(" new local edit");
    await acknowledge(old);
    assert.equal(
      await page.evaluate(() => document.body.dataset.saveState),
      "dirty",
      "old note ACK cannot mark new note saved",
    );
    assert.match(
      await page.locator(".cm-content").innerText(),
      /new local edit/u,
    );
    await page.close();
    console.log(
      `PASS ${secondary ? "sidebar" : "primary"}: Save, Ctrl+S, blur, queued request, failure retry, security mutation, conversion ACK, stale note ACK`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
