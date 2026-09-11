import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

// Only the pure formatter is called. No VS Code account registration, prompts,
// filesystem lock, transport request, or real secret storage is exercised.
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/auth/provider.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode", "proper-lockfile"],
  logLevel: "silent",
});
const require = createRequire(import.meta.url);
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, {
  module,
  exports: module.exports,
  require: (name) =>
    ["vscode", "proper-lockfile"].includes(name) ? {} : require(name),
});
const { standardNotesAccountMessage } = module.exports;
const canary = "private-ui-canary@example.invalid";

test("account UI explains invalid response with only fixed stage/reason/status", () => {
  const value = standardNotesAccountMessage({
    issue: "invalid_response",
    email: canary,
    diagnostic: {
      stage: "login",
      reason: "session-cookies",
      status: 200,
      email: canary,
      message: "private-message-canary",
      body: "private-body-canary",
      access_token: "private-token-canary",
    },
  });
  assert.match(value, /authentication response could not be validated/u);
  assert.match(value, /\[login\/session-cookies; HTTP 200\]$/u);
  assert.doesNotMatch(value, /private-|@|access_token|body|email/u);
});

test("unknown issue and hostile diagnostic values never become UI message text", () => {
  for (const issue of [
    canary,
    "__proto__",
    "constructor",
    "toString",
    undefined,
  ]) {
    const value = standardNotesAccountMessage({
      issue,
      diagnostic: { stage: canary, reason: canary, status: canary },
    });
    assert.equal(
      value,
      "Sign-in could not be completed. Retry; no notes were accessed.",
    );
  }
});

test("UI omits malformed reason/status while retaining an allowed stage", () => {
  const value = standardNotesAccountMessage({
    issue: "invalid_response",
    diagnostic: { stage: "session-check", reason: canary, status: canary },
  });
  assert.match(value, /\[session-check\]$/u);
  assert.doesNotMatch(value, /private-|HTTP/u);
});

test("HTTP rate limit keeps its actionable explanation and diagnostic", () => {
  const value = standardNotesAccountMessage({
    issue: "rate_limited",
    diagnostic: { stage: "login-params", reason: "http-status", status: 429 },
  });
  assert.match(value, /asked to wait/u);
  assert.match(value, /\[login-params\/http-status; HTTP 429\]$/u);
  assert.doesNotMatch(value, /invalid|unsupported/u);
});

test("an absent diagnostic leaves existing auth messages unchanged", () => {
  assert.equal(
    standardNotesAccountMessage({ issue: "invalid_response" }),
    "The authentication response could not be validated. No notes were accessed.",
  );
  assert.equal(
    standardNotesAccountMessage({ issue: "verification_required" }),
    "Standard Notes requires additional human verification. This first auth-only version cannot complete that challenge.",
  );
});
