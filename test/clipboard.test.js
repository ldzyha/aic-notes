import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ClipboardHost } from "../src/clipboard.js";
import { makeClipboardClient } from "../src/webview/host-shim.js";
import { DisposableScope } from "../src/lifecycle.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(clipboard = {}) {
  const messages = [];
  const webview = { postMessage: async (msg) => { messages.push(msg); return true; } };
  const scope = new DisposableScope();
  const state = {
    webview, identity: "file:///note-a", relativePath: "note-a.note.md",
    generation: 1, hasSurface: true, ready: true, readOnly: false,
  };
  const host = new ClipboardHost({ scope, clipboard, context: () => state, timeoutMs: 15 });
  const request = (action, extra = {}) => ({
    type: "clipboard.request", requestId: `r-${messages.length + 1}`,
    action, relativePath: "note-a.note.md", generation: 1, ...extra,
  });
  return { messages, webview, scope, state, host, request };
}

test("host reads only explicit bounded text and acknowledges a real write", async () => {
  const writes = [];
  const f = fixture({ readText: async () => "secret", writeText: async (text) => { writes.push(text); } });
  await f.host.handle(f.request("read"), f.webview);
  assert.deepEqual(f.messages[0], { type: "clipboard.response", requestId: "r-1", ok: true, text: "secret" });
  await f.host.handle(f.request("write", { text: "exact" }), f.webview);
  assert.deepEqual(writes, ["exact"]);
  assert.deepEqual(f.messages[1], { type: "clipboard.response", requestId: "r-2", ok: true });
});

test("host rejects oversized reads and writes without returning contents", async () => {
  let writes = 0;
  const f = fixture({ readText: async () => "s".repeat(16 * 1024 + 1), writeText: async () => { writes++; } });
  await f.host.handle(f.request("read"), f.webview);
  await f.host.handle(f.request("write", { text: "😀".repeat(600_000) }), f.webview);
  assert.equal(writes, 0);
  assert.equal(f.messages[0].error, "oversize");
  assert.equal(f.messages[1].error, "oversize");
  assert.ok(f.messages.every((msg) => !Object.hasOwn(msg, "text")));
});

test("host never delivers read contents after source, generation, view, permission, or scope changes", async () => {
  for (const change of ["identity", "generation", "webview", "readOnly", "disposed"]) {
    const reading = deferred();
    const f = fixture({ readText: () => reading.promise });
    const ongoing = f.host.handle(f.request("read"), f.webview);
    if (change === "identity") f.state.identity = "file:///note-b";
    if (change === "generation") f.state.generation++;
    if (change === "webview") f.state.webview = { postMessage: async () => true };
    if (change === "readOnly") f.state.readOnly = true;
    if (change === "disposed") f.scope.dispose();
    reading.resolve("secret");
    await ongoing;
    assert.ok(f.messages.length === 0 || f.messages[0].error === "stale", change);
    assert.ok(f.messages.every((msg) => !Object.hasOwn(msg, "text")), change);
  }
});

test("host rejects malformed requests and fixed-category failures", async () => {
  const f = fixture({ readText: async () => { throw new Error("secret in platform failure"); } });
  await f.host.handle(f.request("read", { requestId: "bad id" }), f.webview);
  await f.host.handle(f.request("delete"), f.webview);
  assert.equal(f.messages.length, 0);
  await f.host.handle(f.request("read"), f.webview);
  assert.equal(f.messages[0].error, "unavailable");
  assert.equal(JSON.stringify(f.messages).includes("secret"), false);
  const stalled = fixture({ readText: () => new Promise(() => {}) });
  await stalled.host.handle(stalled.request("read"), stalled.webview);
  assert.equal(stalled.messages[0].error, "timeout");
});

test("host never reads or writes for missing or non-string request identifiers", async () => {
  let operations = 0;
  const f = fixture({ readText: async () => { operations++; return "synthetic"; }, writeText: async () => { operations++; } });
  for (const requestId of [undefined, null, false, 0, 123, {}, []]) {
    await f.host.handle(f.request("read", { requestId }), f.webview);
    await f.host.handle(f.request("write", { requestId, text: "synthetic" }), f.webview);
  }
  assert.equal(operations, 0);
  assert.deepEqual(f.messages, []);
});

test("client ignores unknown ACKs, cancels on reset/pagehide, and bounds waits", async () => {
  const sent = [];
  const listeners = new Map();
  const eventTarget = {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  const state = { relativePath: "a.note.md", generation: 2, hasSurface: true, readOnly: false };
  const client = makeClipboardClient({ postMessage: (msg) => sent.push(msg) }, state, eventTarget, 15);
  const copied = client.writeText("exact");
  assert.equal(client.handleMessage({ type: "clipboard.response", requestId: "unknown", ok: true }), true);
  assert.equal(sent[0].action, "write");
  client.handleMessage({ type: "clipboard.response", requestId: sent[0].requestId, ok: true });
  assert.equal(await copied, true);
  const reading = client.readText();
  client.cancel();
  await assert.rejects(reading, /stale/u);
  const stalled = client.readText();
  await assert.rejects(stalled, /timeout/u);
  const ended = client.readText();
  listeners.get("pagehide")();
  await assert.rejects(ended, /stale/u);
  assert.equal(client.handleMessage({ type: "clipboard.response", requestId: sent.at(-1).requestId, ok: true, text: "secret" }), true);
});

test("both providers and webview wire only the scoped security request path", async () => {
  const main = await readFile(new URL("../src/webview/main.js", import.meta.url), "utf8");
  const editor = await readFile(new URL("../src/editor/provider.js", import.meta.url), "utf8");
  const secondary = await readFile(new URL("../src/secondary/provider.js", import.meta.url), "utf8");
  assert.match(main, /onReadClipboard:\s*\(\) => clipboard\.readText\(\)/u);
  assert.match(main, /onCopy:\s*\(source\) => clipboard\.writeText\(source\)/u);
  assert.match(editor, /session\.clipboard\.handle\(msg, webview\)/u);
  assert.match(secondary, /clipboard\.handle\(message, view\.webview\)/u);
});
