import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runWasmBridge } from "../src/sync/wasm-bridge.js";

test("Windows WebAssembly bridge runs in-process without inheriting the host environment", async () => {
  const extensionPath = fileURLToPath(new URL("..", import.meta.url));
  process.env.AIC_NOTES_OVERSIZED_HOST_VALUE = "x".repeat(128 * 1024);
  try {
    const response = await runWasmBridge(
      { extensionPath },
      { operation: "unknown", hostPlatform: "win32" },
    );
    assert.deepEqual(
      { ok: response.ok, code: response.code },
      { ok: false, code: "sn_bridge_operation" },
    );
  } finally {
    delete process.env.AIC_NOTES_OVERSIZED_HOST_VALUE;
  }
});
