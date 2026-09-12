import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

// Execute the registered command, real provider and real account lifecycle.
// Only native VS Code UI/storage and the filesystem lease are replaced. No
// credential, file, network request or real account is read by this harness.
const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/auth/provider.js", import.meta.url)),
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  write: false,
  external: ["vscode"],
  plugins: [
    {
      name: "synthetic-account-lease",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/operation-lock\.js$/ }, () => ({
          path: "auth-prompt-test-lock",
          external: true,
        }));
      },
    },
  ],
  logLevel: "silent",
});
const require = createRequire(import.meta.url);
const EMAIL = "prompt-fixture@example.invalid";
const savedAccount = () => ({
  schema: 1,
  server: "https://api.standardnotes.com",
  user: { uuid: "synthetic-prompt-user", email: EMAIL },
  session: {
    access_token: "1:synthetic-prompt-access",
    refresh_token: "1:synthetic-prompt-refresh",
    access_expiration: 2000000000000,
    refresh_expiration: 2100000000000,
    readonly_access: false,
    cookies: [],
  },
  masterKey: "a".repeat(64),
  keyParams: { version: "004", identifier: EMAIL, pw_nonce: "b".repeat(64) },
});

async function eventually(predicate, description) {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`Did not reach ${description}`);
}

function event() {
  const listeners = new Set();
  return {
    listeners,
    subscribe(callback) {
      listeners.add(callback);
      return { dispose: () => listeners.delete(callback) };
    },
    fire(value) {
      for (const callback of [...listeners]) callback(value);
    },
  };
}

async function harness(
  t,
  {
    throwCreate = false,
    throwShow = false,
    abortBeforePrompt = false,
    holdStartup = false,
    existingSession = false,
  } = {},
) {
  const commands = new Map();
  const prompts = [];
  const signals = [];
  const warnings = [];
  const notices = [];
  const trustChanged = event();
  const secretChanged = event();
  const effects = {
    requests: 0,
    stores: 0,
    deletes: 0,
    locks: 0,
    releases: 0,
    checks: 0,
  };
  let releaseStartup;
  const startup = new Promise((resolve) => {
    releaseStartup = resolve;
  });
  let secretReads = 0;
  const stored = existingSession ? JSON.stringify(savedAccount()) : undefined;
  let activeLocks = 0;
  class TrackedAbortController {
    constructor() {
      const controller = new AbortController();
      this.signal = controller.signal;
      this.abort = () => controller.abort();
      const listeners = new Set();
      const add = this.signal.addEventListener.bind(this.signal);
      const remove = this.signal.removeEventListener.bind(this.signal);
      this.signal.addEventListener = (type, callback, options) => {
        if (type === "abort") listeners.add(callback);
        add(type, callback, options);
      };
      this.signal.removeEventListener = (type, callback, options) => {
        if (type === "abort") listeners.delete(callback);
        remove(type, callback, options);
      };
      signals.push({ signal: this.signal, listeners, abort: this.abort });
    }
  }
  const vscode = {
    ThemeIcon: class {
      constructor(id) {
        this.id = id;
      }
    },
    InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
    StatusBarAlignment: { Left: 1 },
    commands: {
      registerCommand(id, callback) {
        commands.set(id, callback);
        return { dispose: () => commands.delete(id) };
      },
    },
    workspace: {
      isTrusted: true,
      onDidGrantWorkspaceTrust: (callback) => trustChanged.subscribe(callback),
    },
    window: {
      createStatusBarItem: () => ({ show() {}, dispose() {} }),
      showWarningMessage: async (message) => warnings.push(message),
      showInformationMessage: async (message) => notices.push(message),
      showQuickPick: async () => undefined,
      createInputBox() {
        if (throwCreate) throw new Error("synthetic native create failure");
        const events = {
          accept: event(),
          button: event(),
          change: event(),
          hide: event(),
        };
        const input = {
          events,
          value: "",
          buttons: [],
          visible: false,
          disposed: false,
          disposeCount: 0,
          onDidAccept: (callback) => events.accept.subscribe(callback),
          onDidTriggerButton: (callback) => events.button.subscribe(callback),
          onDidChangeValue: (callback) => events.change.subscribe(callback),
          onDidHide: (callback) => events.hide.subscribe(callback),
          type(value) {
            this.value = value;
            events.change.fire(value);
          },
          enter(value = this.value) {
            this.type(value);
            // No test-side validator decides acceptance. Production's event
            // handler must reject invalid values on both Enter and the button.
            events.accept.fire();
          },
          continue(value = this.value) {
            this.type(value);
            const button = this.buttons.find((item) =>
              /continue/iu.test(item.tooltip ?? ""),
            );
            assert.ok(button, "a visible Continue action is provided");
            events.button.fire(button);
          },
          show() {
            if (throwShow) throw new Error("synthetic native show failure");
            this.visible = true;
          },
          hide() {
            this.visible = false;
            events.hide.fire();
          },
          dispose() {
            this.disposed = true;
            this.disposeCount++;
            this.hide();
          },
        };
        prompts.push(input);
        return input;
      },
    },
  };
  const context = {
    globalStorageUri: { fsPath: "synthetic-no-filesystem-access" },
    subscriptions: [],
    secrets: {
      get: async () => {
        if (++secretReads === 1 && holdStartup) await startup;
        return stored;
      },
      store: async () => effects.stores++,
      delete: async () => effects.deletes++,
      onDidChange: (callback) => secretChanged.subscribe(callback),
    },
  };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module,
    exports: module.exports,
    AbortController: TrackedAbortController,
    Buffer,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      effects.requests++;
      throw new Error("Network is forbidden in native prompt tests");
    },
    require: (name) => {
      if (name === "vscode") return vscode;
      if (name === "auth-prompt-test-lock") {
        return {
          createAuthOperationLock: () => async () => {
            assert.equal(activeLocks, 0, "no concurrent account lease");
            activeLocks++;
            effects.locks++;
            if (abortBeforePrompt) signals.at(-1).abort();
            let released = false;
            return async () => {
              assert.equal(released, false, "account lease released only once");
              released = true;
              activeLocks--;
              effects.releases++;
            };
          },
        };
      }
      return require(name);
    },
  });
  const account = module.exports.registerStandardNotesAuth(context);
  if (existingSession) {
    // Exercise the real restore/parse/check orchestration but not HTTP. This
    // fixture is synthetic and no real SecretStorage implementation is loaded.
    account.transport.check = async (value) => {
      effects.checks++;
      assert.equal(value.user.uuid, "synthetic-prompt-user");
    };
  }
  const pending = [];
  const invoke = (id = "aicNotes.signInStandardNotes") => {
    assert.ok(commands.has(id), "invoke the production registered command");
    const promise = commands.get(id)();
    pending.push(promise);
    return promise;
  };
  const dispose = () => {
    for (const subscription of context.subscriptions.splice(0))
      subscription.dispose();
  };
  t.after(async () => {
    dispose();
    releaseStartup();
    for (const input of prompts) input.hide();
    await Promise.allSettled(pending);
    assert.equal(effects.requests, 0, "no authentication/network request");
    assert.equal(effects.stores, 0, "no session persistence");
    assert.equal(activeLocks, 0, "no surviving account lease");
  });
  if (!holdStartup)
    await eventually(
      () =>
        account.state.status === (existingSession ? "connected" : "signed-out"),
      "initial restore",
    );
  return {
    account,
    invoke,
    dispose,
    releaseStartup,
    prompts,
    signals,
    warnings,
    notices,
    commands,
    trustChanged,
    secretChanged,
    effects,
    vscode,
    async input(index) {
      await eventually(() => prompts.length > index, `native prompt ${index}`);
      return prompts[index];
    },
    assertPromptCleanup() {
      assert.ok(
        prompts.every((input) => input.disposed && input.disposeCount === 1),
        "all native inputs disposed exactly once",
      );
      assert.ok(
        prompts.every((input) => input.value === ""),
        "completed or canceled inputs do not retain credential text",
      );
      assert.ok(
        prompts.every((input) =>
          Object.values(input.events).every(
            ({ listeners }) => listeners.size === 0,
          ),
        ),
        "all accept/button/change/hide subscriptions removed",
      );
      assert.ok(
        signals.every(({ listeners }) => listeners.size === 0),
        "no account abort listeners remain",
      );
    },
  };
}

for (const action of ["enter", "continue"]) {
  test(`registered sign-in: ${action} advances email to password; Escape cancels silently`, async (t) => {
    const h = await harness(t);
    const signingIn = h.invoke();
    const email = await h.input(0);
    assert.equal(email.title, "Standard Notes · Sign in");
    assert.equal(email.placeholder, "you@example.com");
    assert.equal(email.ignoreFocusOut, true);
    assert.notEqual(email.password, true);
    assert.equal(email.visible, true);
    email[action](`  ${EMAIL}  `);
    const password = await h.input(1);
    assert.equal(password.title, "Standard Notes · Password");
    assert.equal(password.password, true);
    assert.equal(password.ignoreFocusOut, true);
    assert.equal(email.disposed, true, "email cleanup precedes password");
    assert.equal(h.account.state.status, "signing-in");
    password.hide();
    await signingIn;
    assert.equal(h.account.state.status, "signed-out");
    assert.equal(h.account.state.issue, undefined);
    assert.deepEqual(h.warnings, []);
    assert.deepEqual(h.notices, []);
    assert.equal(h.effects.locks, 1);
    assert.equal(h.effects.releases, 1);
    h.assertPromptCleanup();
  });

  test(`${action} uses production validation and recovers after invalid email/password`, async (t) => {
    const h = await harness(t);
    const signingIn = h.invoke();
    const email = await h.input(0);
    for (const invalid of ["", "   ", "x".repeat(321)]) {
      email[action](invalid);
      assert.match(email.validationMessage, /email/u);
      assert.equal(email.disposed, false);
      assert.equal(h.prompts.length, 1);
      assert.equal(h.account.state.status, "signing-in");
    }
    email.type(EMAIL);
    assert.equal(
      email.validationMessage,
      undefined,
      "typing valid clears error",
    );
    email[action]();
    const password = await h.input(1);
    for (const invalid of ["", "x".repeat(4097)]) {
      password[action](invalid);
      assert.match(password.validationMessage, /password/u);
      assert.equal(password.disposed, false);
    }
    password.type("synthetic-only");
    assert.equal(password.validationMessage, undefined);
    password.hide();
    await signingIn;
    assert.equal(h.account.state.issue, undefined);
    h.assertPromptCleanup();
  });
}

test("canceling the email prompt never opens password or displays an auth failure", async (t) => {
  const h = await harness(t);
  const signingIn = h.invoke();
  (await h.input(0)).hide();
  await signingIn;
  assert.equal(h.prompts.length, 1);
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(h.account.state.issue, undefined);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

for (const index of [0, 1]) {
  test(`disposing auth while native prompt ${index} is pending cancels and removes listeners`, async (t) => {
    const h = await harness(t);
    const signingIn = h.invoke();
    const email = await h.input(0);
    if (index === 1) email.enter(EMAIL);
    const current = await h.input(index);
    h.dispose();
    await signingIn;
    assert.equal(h.signals.at(-1).signal.aborted, true);
    assert.equal(current.disposed, true);
    assert.equal(current.visible, false);
    assert.equal(h.commands.size, 0);
    assert.equal(h.trustChanged.listeners.size, 0);
    assert.equal(h.secretChanged.listeners.size, 0);
    assert.deepEqual(h.warnings, []);
    h.assertPromptCleanup();
  });
}

test("sign-out command cancels an open email prompt before releasing its lease", async (t) => {
  const h = await harness(t);
  const signingIn = h.invoke();
  const email = await h.input(0);
  const signingOut = h.invoke("aicNotes.signOutStandardNotes");
  await Promise.all([signingIn, signingOut]);
  assert.equal(email.disposed, true);
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(h.effects.locks, 2);
  assert.equal(h.effects.releases, 2);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

for (const mode of ["throwCreate", "throwShow"]) {
  test(`${mode}: synchronous native failure cleans up inputs and listeners`, async (t) => {
    const h = await harness(t, { [mode]: true });
    await h.invoke();
    assert.equal(h.account.state.issue, "authentication_failed");
    assert.equal(h.warnings.length, 1);
    assert.doesNotMatch(h.warnings[0], /synthetic/u);
    h.assertPromptCleanup();
  });
}

test("already-aborted credentials callback never displays an input", async (t) => {
  const h = await harness(t, { abortBeforePrompt: true });
  await h.invoke();
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(h.account.state.issue, undefined);
  assert.equal(h.prompts.length, 0, "no native input created after abort");
  assert.ok(h.prompts.every((input) => !input.visible));
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("duplicate and late native accept/button/hide events advance only once", async (t) => {
  const h = await harness(t);
  const signingIn = h.invoke();
  const email = await h.input(0);
  const lateAccept = [...email.events.accept.listeners];
  const lateButton = [...email.events.button.listeners];
  const lateHide = [...email.events.hide.listeners];
  const button = email.buttons[0];
  email.enter(EMAIL);
  for (const callback of lateAccept) callback();
  for (const callback of lateButton) callback(button);
  for (const callback of lateHide) callback();
  const password = await h.input(1);
  password.hide();
  for (const callback of lateAccept) callback();
  await signingIn;
  assert.equal(h.prompts.length, 2);
  assert.equal(h.effects.locks, 1);
  assert.equal(h.effects.releases, 1);
  assert.equal(h.account.state.issue, undefined);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("unknown native button does not accept the email", async (t) => {
  const h = await harness(t);
  const signingIn = h.invoke();
  const email = await h.input(0);
  email.type(EMAIL);
  email.events.button.fire({ tooltip: "Unrelated action" });
  assert.equal(email.disposed, false);
  assert.equal(h.prompts.length, 1);
  email.hide();
  await signingIn;
  h.assertPromptCleanup();
});

test("untrusted workspace refuses sign-in before opening a prompt or acquiring a lease", async (t) => {
  const h = await harness(t);
  h.vscode.workspace.isTrusted = false;
  await h.invoke();
  assert.equal(h.prompts.length, 0);
  assert.equal(h.effects.locks, 0);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /Trust this workspace/u);
  h.assertPromptCleanup();
});

test("sign-in invoked during initial restore waits and opens email when startup completes", async (t) => {
  const h = await harness(t, { holdStartup: true });
  assert.equal(h.account.state.status, "checking");
  let returned = false;
  const signingIn = h.invoke().then(() => {
    returned = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    h.prompts.length,
    0,
    "do not race secure storage initialization",
  );
  assert.equal(returned, false, "early sign-in must wait, not silently return");
  h.releaseStartup();
  const email = await h.input(0);
  assert.equal(email.placeholder, "you@example.com");
  email.continue(EMAIL);
  (await h.input(1)).hide();
  await signingIn;
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(h.account.state.issue, undefined);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("early sign-in does not open login when startup restores an existing verified session", async (t) => {
  const h = await harness(t, { holdStartup: true, existingSession: true });
  assert.equal(h.account.state.status, "checking");
  const signingIn = h.invoke();
  assert.equal(h.prompts.length, 0);
  h.releaseStartup();
  await signingIn;
  await eventually(
    () => h.account.state.status === "connected",
    "saved session restore",
  );
  assert.equal(h.effects.checks, 1, "restored account was verified once");
  assert.equal(
    h.prompts.length,
    0,
    "do not replace an already restored account",
  );
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("disposing before startup readiness prevents a queued sign-in prompt", async (t) => {
  const h = await harness(t, { holdStartup: true });
  assert.equal(h.account.state.status, "checking");
  const signingIn = h.invoke();
  h.dispose();
  h.releaseStartup();
  await signingIn;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.account.disposed, true);
  assert.equal(h.prompts.length, 0);
  assert.equal(h.effects.locks, 0);
  assert.equal(h.commands.size, 0);
  assert.equal(h.secretChanged.listeners.size, 0);
  assert.equal(h.trustChanged.listeners.size, 0);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("sign-out before startup completes invalidates the queued sign-in", async (t) => {
  const h = await harness(t, { holdStartup: true });
  const signingIn = h.invoke();
  const signingOut = h.invoke("aicNotes.signOutStandardNotes");
  h.releaseStartup();
  await Promise.all([signingIn, signingOut]);
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(
    h.prompts.length,
    0,
    "sign-out must not be followed by a stale login",
  );
  assert.equal(h.effects.locks, 1, "only the sign-out action acquires a lease");
  assert.equal(h.effects.releases, 1);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});

test("repeated sign-in commands during startup open only one email prompt", async (t) => {
  const h = await harness(t, { holdStartup: true });
  const first = h.invoke();
  const second = h.invoke();
  assert.equal(h.prompts.length, 0);
  h.releaseStartup();
  const email = await h.input(0);
  assert.equal(h.prompts.length, 1);
  email.hide();
  await Promise.all([first, second]);
  assert.equal(h.account.state.status, "signed-out");
  assert.equal(h.prompts.length, 1);
  assert.equal(h.effects.locks, 1);
  assert.equal(h.effects.releases, 1);
  assert.deepEqual(h.warnings, []);
  h.assertPromptCleanup();
});
