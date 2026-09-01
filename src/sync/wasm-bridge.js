import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import * as vm from "node:vm";
import { performance } from "node:perf_hooks";
import { TextDecoder, TextEncoder } from "node:util";
import { structuredError } from "../errors.js";

let runtime;
let queue = Promise.resolve();

async function loadRuntime(context) {
  if (runtime) return runtime;
  runtime = (async () => {
    globalThis.fs ??= fs;
    globalThis.path ??= path;
    globalThis.crypto ??= crypto.webcrypto;
    globalThis.performance ??= performance;
    globalThis.TextDecoder ??= TextDecoder;
    globalThis.TextEncoder ??= TextEncoder;

    const root = path.join(context.extensionPath, "bin", "wasm");
    const support = await fs.promises.readFile(path.join(root, "wasm_exec.js"), "utf8");
    vm.runInThisContext(support, { filename: "aic-notes-wasm-exec.js" });
    const GoRuntime = globalThis.Go;
    if (typeof GoRuntime !== "function") throw new Error("Go WebAssembly runtime did not initialize");
    const go = new GoRuntime();
    go.argv = ["aic-notes-sn-bridge.wasm"];
    // The bridge receives every required value through its JSON request. Passing the
    // extension host environment into Go/WASM is both unnecessary and unsafe: CI and
    // enterprise hosts can exceed Go's command-line/environment memory limit.
    go.env = { TMPDIR: os.tmpdir() };
    go.exit = (code) => {
      if (code) throw new Error(`Standard Notes WebAssembly bridge exited with ${code}`);
    };
    const bytes = await fs.promises.readFile(path.join(root, "aic-notes-sn-bridge.wasm"));
    const instantiated = await WebAssembly.instantiate(bytes, go.importObject);
    void go.run(instantiated.instance);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const invoke = globalThis.__aicNotesStandardNotesBridge;
    if (typeof invoke !== "function") throw new Error("Standard Notes WebAssembly bridge is unavailable");
    return invoke;
  })();
  return runtime;
}

export function runWasmBridge(context, request) {
  const operation = queue.then(async () => {
    try {
      const invoke = await loadRuntime(context);
      return JSON.parse(await invoke(JSON.stringify(request)));
    } catch (error) {
      runtime = undefined;
      throw structuredError("sn_wasm_failed", "the in-process Standard Notes bridge failed", [
        "Reload VS Code and retry",
        error?.message ? `Runtime: ${error.message}` : "Reinstall the matching AIC Notes VSIX",
      ]);
    }
  });
  queue = operation.catch(() => undefined);
  return operation;
}
