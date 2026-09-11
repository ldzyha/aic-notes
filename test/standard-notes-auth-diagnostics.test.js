import test from "node:test";
import assert from "node:assert/strict";
import {
  StandardNotesAuthTransport,
  StandardNotesAuthError,
  STANDARD_NOTES_SERVER,
  authDiagnostic,
} from "../src/auth/standard-notes-transport.js";
import { StandardNotesAccount, AUTH_SECRET_KEY } from "../src/auth/session.js";

// Synthetic fixtures only. No test below uses global fetch, the real KDF,
// account storage, cookies from the host, or the user's credentials.
const privateMarker = "private-diagnostic-marker@example.invalid";
const params = { version: "004", pw_nonce: "a".repeat(64) };
const keys = { masterKey: "b".repeat(64), serverPassword: "c".repeat(64) };
const user = { uuid: "synthetic-user", email: privateMarker };
const session = {
  access_token: "1:synthetic-access-token",
  refresh_token: "1:synthetic-refresh-token",
  access_expiration: 2000000000000,
  refresh_expiration: 2100000000000,
  readonly_access: false,
};
const account = () => ({
  schema: 1,
  server: STANDARD_NOTES_SERVER,
  user: { ...user },
  session: { ...session, cookies: [] },
  masterKey: keys.masterKey,
  keyParams: { ...params, identifier: user.email },
});
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
  });
const stages = [
  ["POST", "/v2/login-params", "login-params"],
  ["POST", "/v2/login", "login"],
  ["GET", "/v1/sessions", "session-check"],
  ["POST", "/v1/sessions/refresh", "session-refresh"],
  ["POST", "/v1/logout", "logout"],
];

function assertPrivate(value) {
  const encoded = JSON.stringify(value);
  assert.doesNotMatch(
    encoded,
    /private-diagnostic-marker|synthetic-access-token|synthetic-refresh-token|raw-body-secret|raw-error-secret|masterKey|serverPassword|password|access_token|refresh_token/u,
  );
}

function matchesDiagnostic(code, stage, reason, status) {
  return (error) => {
    assert.equal(error.code, code);
    const diagnostic = authDiagnostic(error);
    assert.equal(diagnostic?.stage, stage);
    assert.equal(diagnostic?.reason, reason);
    if (status !== undefined) assert.equal(diagnostic.status, status);
    assert.ok(
      Object.keys(diagnostic).every((key) =>
        ["stage", "reason", "status"].includes(key),
      ),
    );
    assertPrivate(diagnostic);
    return true;
  };
}

function signInTransport(loginData, loginParams = params) {
  return new StandardNotesAuthTransport({
    derive: async () => ({ ...keys }),
    fetch: async (url) =>
      url.endsWith("/login-params")
        ? json({ data: loginParams })
        : json({ data: loginData }),
  });
}

for (const [method, endpoint, stage] of stages) {
  test(`invalid JSON identifies ${stage} without returning response content`, async () => {
    const transport = new StandardNotesAuthTransport({
      fetch: async () =>
        new Response(`<html>raw-body-secret ${privateMarker}</html>`, {
          headers: { "Content-Type": "text/html" },
        }),
    });
    await assert.rejects(
      transport.request(method, endpoint),
      matchesDiagnostic("invalid_response", stage, "invalid-json", 200),
    );
  });
}

test("UTF-8 BOM responses preserve successful login and numeric session expirations", async () => {
  const calls = [];
  const transport = new StandardNotesAuthTransport({
    derive: async (_email, _password, receivedParams) => {
      assert.deepEqual(receivedParams, params);
      return { ...keys };
    },
    fetch: async (url) => {
      calls.push(url);
      const payload = url.endsWith("/login-params")
        ? params
        : url.endsWith("/login")
          ? { user, session }
          : [];
      return new Response(`\uFEFF${JSON.stringify({ data: payload })}`, {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    },
  });
  const result = await transport.signIn({
    email: user.email,
    password: "synthetic-password",
  });
  assert.equal(result.session.access_expiration, session.access_expiration);
  assert.equal(result.session.refresh_expiration, session.refresh_expiration);
  assert.equal(result.masterKey, keys.masterKey);
  await transport.check(result);
  assert.equal(calls.length, 3);
});

for (const [status, code] of [
  [429, "rate_limited"],
  [500, "server_error"],
  [502, "server_error"],
  [503, "server_error"],
]) {
  test(`HTML HTTP ${status} stays ${code}, not invalid_response`, async () => {
    const transport = new StandardNotesAuthTransport({
      fetch: async () =>
        new Response(`<html>raw-body-secret ${privateMarker}</html>`, {
          status,
          headers: { "Content-Type": "text/html" },
        }),
    });
    await assert.rejects(transport.request("POST", "/v2/login"), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      const diagnostic = authDiagnostic(error);
      assert.equal(diagnostic?.stage, "login");
      assertPrivate(diagnostic);
      return true;
    });
  });
}

for (const status of [200, 401, 403, 429, 503]) {
  test(`captcha header survives HTML HTTP ${status} and never exposes its URL`, async () => {
    const transport = new StandardNotesAuthTransport({
      fetch: async () =>
        new Response("<html>raw-body-secret</html>", {
          status,
          headers: {
            "Content-Type": "text/html",
            "x-captcha-required": `https://untrusted.invalid/${privateMarker}`,
          },
        }),
    });
    await assert.rejects(
      transport.request("POST", "/v2/login-params"),
      (error) => {
        assert.equal(error.code, "verification_required");
        assert.equal(error.status, status);
        const diagnostic = authDiagnostic(error);
        assert.equal(diagnostic?.stage, "login-params");
        assertPrivate(diagnostic);
        assert.doesNotMatch(JSON.stringify(diagnostic), /https:|untrusted/u);
        return true;
      },
    );
  });
}

test("oversized streaming response is canceled and reports its bounded reason", async () => {
  let canceled = false;
  const transport = new StandardNotesAuthTransport({
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(64 * 1024).fill(65));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
  });
  await assert.rejects(
    transport.request("GET", "/v1/sessions"),
    matchesDiagnostic(
      "invalid_response",
      "session-check",
      "response-too-large",
      200,
    ),
  );
  assert.equal(canceled, true);
});

for (const badParams of [null, {}, { version: "004", pw_nonce: "short" }]) {
  test(`malformed key params ${JSON.stringify(badParams)} identify the params stage`, async () => {
    const transport = signInTransport({ user, session }, badParams);
    await assert.rejects(
      transport.signIn({ email: user.email, password: "synthetic-password" }),
      matchesDiagnostic("invalid_response", "login-params", "key-params"),
    );
  });
}

for (const [reason, mutate] of [
  ["user", (data) => ({ ...data, user: { email: privateMarker } })],
  ["session-tokens", (data) => ({ ...data, session: null })],
  [
    "session-tokens",
    (data) => ({ ...data, session: { ...session, access_token: "short" } }),
  ],
  [
    "session-expiration",
    (data) => ({
      ...data,
      session: { ...session, access_expiration: "2000000000000" },
    }),
  ],
  [
    "session-cookies",
    (data) => ({
      ...data,
      session: {
        ...session,
        access_token: "2:synthetic-selector",
        refresh_token: "2:synthetic-selector",
      },
    }),
  ],
]) {
  test(`malformed login ${reason} reports structure only`, async () => {
    const transport = signInTransport(mutate({ user, session }));
    await assert.rejects(
      transport.signIn({ email: user.email, password: "synthetic-password" }),
      matchesDiagnostic("invalid_response", "login", reason),
    );
  });
}

test("invalid session-list and refreshed-session structures identify their own endpoint", async () => {
  const transport = new StandardNotesAuthTransport({
    fetch: async () => json({ data: { raw: privateMarker } }),
  });
  await assert.rejects(
    transport.check(account()),
    matchesDiagnostic("invalid_response", "session-check", "session-list"),
  );
  await assert.rejects(
    transport.refresh(account()),
    matchesDiagnostic("invalid_response", "session-refresh", "session-tokens"),
  );
});

test("diagnostic is an allowlisted copy, never an error/body/credential projection", () => {
  const error = new StandardNotesAuthError("invalid_response", 200, {
    stage: "login",
    reason: "session-tokens",
    body: "raw-body-secret",
    email: privateMarker,
    session,
    password: "synthetic-password",
  });
  error.message = `raw-error-secret ${privateMarker}`;
  error.body = "raw-body-secret";
  error.email = privateMarker;
  error.session = session;
  const diagnostic = authDiagnostic(error);
  assert.deepEqual(diagnostic, {
    stage: "login",
    reason: "session-tokens",
    status: 200,
  });
  assert.equal(Object.getPrototypeOf(diagnostic), Object.prototype);
  assertPrivate(diagnostic);
  if (!Object.isFrozen(diagnostic)) diagnostic.stage = "logout";
  assert.equal(authDiagnostic(error).stage, "login");
});

test("unknown diagnostic values and raw error messages cannot become diagnostic strings", () => {
  const error = new StandardNotesAuthError("invalid_response", 200, {
    stage: privateMarker,
    reason: "raw-body-secret",
  });
  error.message = "raw-error-secret";
  for (const candidate of [error, new Error(privateMarker), null, undefined]) {
    assert.equal(authDiagnostic(candidate), undefined);
  }
});

test("diagnostic status accepts only integer HTTP values and drops unknown reasons", () => {
  for (const status of [
    0,
    99,
    600,
    -1,
    200.5,
    NaN,
    Infinity,
    "200",
    privateMarker,
  ]) {
    const diagnostic = authDiagnostic(
      new StandardNotesAuthError("invalid_response", status, {
        stage: "session-refresh",
        reason: privateMarker,
      }),
    );
    assert.deepEqual(diagnostic, { stage: "session-refresh" });
  }
  for (const status of [100, 200, 429, 503, 599]) {
    const diagnostic = authDiagnostic(
      new StandardNotesAuthError("server_error", status, {
        stage: "session-refresh",
        reason: "http-status",
      }),
    );
    assert.deepEqual(diagnostic, {
      stage: "session-refresh",
      reason: "http-status",
      status,
    });
  }
});

test("diagnostics revalidate mutated error fields rather than trusting prior sanitization", () => {
  const error = new StandardNotesAuthError("invalid_response", 200, {
    stage: "login",
    reason: "session-tokens",
  });
  error.status = privateMarker;
  // Whether metadata is exposed directly or through a stored descriptor, a
  // caller cannot inject new public fields by modifying the Error instance.
  error.email = privateMarker;
  error.message = "raw-error-secret";
  const diagnostic = authDiagnostic(error);
  assert.equal(diagnostic.stage, "login");
  assert.equal(diagnostic.status, undefined);
  assertPrivate(diagnostic);
});

function foldedCookieResponse(value, cookieHeader, mode) {
  const response = json({ data: value });
  return {
    status: response.status,
    ok: response.ok,
    body: response.body,
    headers: {
      has: () => false,
      get: (name) => (name === "set-cookie" ? cookieHeader : null),
      ...(mode === "folded-getSetCookie"
        ? { getSetCookie: () => [cookieHeader] }
        : {}),
    },
  };
}

function cookieTransport(cookieHeader, mode) {
  const v2 = {
    ...session,
    access_token: "2:synthetic-selector",
    refresh_token: "2:synthetic-selector",
  };
  return new StandardNotesAuthTransport({
    derive: async () => ({ ...keys }),
    fetch: async (url) =>
      url.endsWith("/login-params")
        ? json({ data: params })
        : foldedCookieResponse({ user, session: v2 }, cookieHeader, mode),
  });
}

for (const mode of ["folded-getSetCookie", "get-fallback"]) {
  for (const reversed of [false, true]) {
    test(`${mode} accepts folded cookie pairs with Expires commas (${reversed ? "refresh first" : "access first"})`, async () => {
      const pairs = [
        "access_token_id=synthetic-access-cookie; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/; Secure; HttpOnly",
        "refresh_token_id=synthetic-refresh-cookie; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Path=/v1/sessions/refresh; Secure; HttpOnly",
      ];
      if (reversed) pairs.reverse();
      const transport = cookieTransport(pairs.join(", "), mode);
      const result = await transport.signIn({
        email: user.email,
        password: "synthetic-password",
      });
      assert.deepEqual(
        result.session.cookies,
        pairs.map((pair) => pair.split(";", 1)[0]),
      );
      assert.equal(result.session.access_expiration, session.access_expiration);
    });
  }
}

for (const [name, cookieHeader] of [
  [
    "duplicate access",
    "access_token_id=one, access_token_id=two, refresh_token_id=three",
  ],
  [
    "duplicate refresh",
    "access_token_id=one, refresh_token_id=two, refresh_token_id=three",
  ],
  ["different suffixes", "access_token_first=one, refresh_token_second=two"],
  [
    "missing refresh",
    "access_token_id=one; Expires=Wed, 21 Oct 2037 07:28:00 GMT",
  ],
  ["header line break", "access_token_id=one\r\nrefresh_token_id=two"],
]) {
  test(`folded cookie ${name} remains rejected`, async () => {
    const transport = cookieTransport(cookieHeader, "get-fallback");
    await assert.rejects(
      transport.signIn({ email: user.email, password: "synthetic-password" }),
      matchesDiagnostic("invalid_response", "login", "session-cookies"),
    );
  });
}

test("a UTF-8 BOM split across network chunks is decoded before JSON validation", async () => {
  const expected = { user: { ...user, uuid: "synthetic-юзер" }, session };
  const transport = new StandardNotesAuthTransport({
    fetch: async () => {
      const encoded = new TextEncoder().encode(
        `\uFEFF${JSON.stringify({ data: expected })}`,
      );
      const chunks = [
        encoded.slice(0, 1),
        encoded.slice(1, 2),
        encoded.slice(2, 3),
        encoded.slice(3, 8),
        encoded.slice(8),
      ];
      return new Response(
        new ReadableStream({
          pull(controller) {
            const next = chunks.shift();
            if (next) controller.enqueue(next);
            else controller.close();
          },
        }),
      );
    },
  });
  const response = await transport.request("POST", "/v2/login");
  assert.deepEqual(response.data, expected);
});

function diagnosticService(initial) {
  const stored = new Map(
    initial ? [[AUTH_SECRET_KEY, JSON.stringify(initial)]] : [],
  );
  const states = [];
  const transport = {
    signIn: async () => account(),
    check: async () => {},
    refresh: async () => account(),
    signOut: async () => {},
  };
  const service = new StandardNotesAccount({
    secrets: {
      get: async (key) => stored.get(key),
      store: async (key, value) => {
        stored.set(key, value);
      },
      delete: async (key) => {
        stored.delete(key);
      },
    },
    transport,
    onChange: (state) => states.push(structuredClone(state)),
    now: () => 1900000000000,
  });
  return { service, transport, states, stored };
}
const credentials = async () => ({
  email: user.email,
  password: "private-credential-canary",
});

test("Account propagates only safe sign-in diagnostics and clears them at retry and success", async () => {
  const h = diagnosticService();
  const error = new StandardNotesAuthError("invalid_response", 200, {
    stage: "login",
    reason: "session-cookies",
    email: privateMarker,
  });
  error.message = "raw-error-secret";
  error.body = "raw-body-secret";
  error.access_token = session.access_token;
  h.transport.signIn = async () => {
    throw error;
  };
  await h.service.signIn(credentials);
  assert.equal(h.service.state.issue, "invalid_response");
  assert.deepEqual(h.service.state.diagnostic, {
    stage: "login",
    reason: "session-cookies",
    status: 200,
  });
  assertPrivate(h.service.state.diagnostic);
  assert.equal(h.stored.size, 0);
  let release;
  h.transport.signIn = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const retry = h.service.signIn(credentials);
  assert.equal(h.service.state.status, "signing-in");
  assert.equal(h.service.state.diagnostic, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  release(account());
  await retry;
  assert.equal(h.service.state.status, "connected");
  assert.equal(h.service.state.issue, undefined);
  assert.equal(h.service.state.diagnostic, undefined);
  assert.doesNotMatch(
    JSON.stringify(h.states),
    /private-credential-canary|raw-error-secret|raw-body-secret|synthetic-access-token|synthetic-refresh-token|masterKey|serverPassword/u,
  );
  for (const state of h.states)
    if (state.diagnostic) assertPrivate(state.diagnostic);
  h.service.dispose();
});

test("Account connection diagnostic is cleared when checking again and after recovery", async () => {
  const h = diagnosticService(account());
  await h.service.restore();
  h.transport.check = async () => {
    throw new StandardNotesAuthError("invalid_response", 200, {
      stage: "session-check",
      reason: "session-list",
    });
  };
  await h.service.check();
  assert.equal(h.service.state.status, "reauth-required");
  assert.deepEqual(h.service.state.diagnostic, {
    stage: "session-check",
    reason: "session-list",
    status: 200,
  });
  assert.equal(h.stored.size, 1);
  let release;
  h.transport.check = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const retry = h.service.check();
  assert.equal(h.service.state.status, "checking");
  assert.equal(h.service.state.diagnostic, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await retry;
  assert.equal(h.service.state.status, "connected");
  assert.equal(h.service.state.diagnostic, undefined);
  h.service.dispose();
});

test("a raw unexpected sign-in error never projects its message or arbitrary diagnostic", async () => {
  const h = diagnosticService();
  h.transport.signIn = async () => {
    throw Object.assign(new Error("raw-error-secret"), {
      body: "raw-body-secret",
      email: privateMarker,
      diagnostic: { stage: privateMarker, reason: "raw-body-secret" },
    });
  };
  await h.service.signIn(credentials);
  assert.equal(h.service.state.issue, "authentication_failed");
  assert.equal(h.service.state.diagnostic, undefined);
  assertPrivate(h.service.state);
  h.service.dispose();
});
