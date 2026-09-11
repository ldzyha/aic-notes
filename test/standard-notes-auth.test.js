import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  StandardNotesAuthTransport,
  StandardNotesAuthError,
  deriveAuthKeys,
  authChallenge,
  parseStoredAccount,
  STANDARD_NOTES_SERVER,
} from "../src/auth/standard-notes-transport.js";
import { StandardNotesAccount, AUTH_SECRET_KEY } from "../src/auth/session.js";

const params = {
  version: "004",
  pw_nonce: "baaec0131d677cf993381367eb082fe377cefe70118c1699cb9b38f0bc850e7b",
};
const keys = { masterKey: "a".repeat(64), serverPassword: "b".repeat(64) };
const session = {
  access_token: "1:test-access",
  refresh_token: "1:test-refresh",
  access_expiration: 2000000000000,
  refresh_expiration: 2100000000000,
  readonly_access: false,
};
const account = () => ({
  schema: 1,
  server: STANDARD_NOTES_SERVER,
  user: { uuid: "test-user", email: "test@example.com" },
  session: { ...session, cookies: [] },
  masterKey: keys.masterKey,
  keyParams: { ...params, identifier: "test@example.com" },
});
const response = (data, status = 200, headers = {}) => {
  const actual = new Headers(headers);
  actual.set("Content-Type", "application/json");
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: actual,
  });
};

test("production-cost 004 derivation matches the official Standard Notes known-answer vector", async () => {
  // Official source: standardnotes/app 6fcb991e626b0388a2220fa0d94815bf6c0c9f8d, packages/snjs/mocha/004.test.js.
  const actual = await deriveAuthKeys("foo@bar.com", "very_secure", params);
  assert.deepEqual(actual, {
    masterKey:
      "5d68e78b56d454e32e1f5dbf4c4e7cf25d74dc1efc942e7c9dfce572c1f3b943",
    serverPassword:
      "83707dfc837b3fe52b317be367d3ed8e14e903b2902760884fd0246a77c2299d",
  });
});

test("challenge encodes the hex digest and old/malformed protocol parameters fail closed", async () => {
  const verifier = "c".repeat(64);
  assert.equal(
    authChallenge(verifier),
    Buffer.from(createHash("sha256").update(verifier).digest("hex")).toString(
      "base64url",
    ),
  );
  await assert.rejects(
    deriveAuthKeys("a", "b", { ...params, version: "003" }),
    { code: "unsupported_protocol" },
  );
  await assert.rejects(
    deriveAuthKeys("a", "b", { ...params, pw_nonce: "bad" }),
    { code: "invalid_response" },
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(deriveAuthKeys("a", "b", params, abort.signal));
});

test("sign-in sends only derived password, uses matching PKCE and never touches items or follows redirects", async () => {
  const calls = [];
  const transport = new StandardNotesAuthTransport({
    derive: async (email, password) => {
      assert.equal(email, "test@example.com");
      assert.equal(password, "private-password");
      return { ...keys };
    },
    fetch: async (url, request) => {
      const body = JSON.parse(request.body);
      calls.push({ url, request, body });
      if (url.endsWith("login-params"))
        return response({
          data: { ...params, identifier: "malicious@server.invalid" },
        });
      return response({ data: { user: account().user, session } });
    },
  });
  const value = await transport.signIn({
    email: "test@example.com",
    password: "private-password",
  });
  assert.equal(value.masterKey, keys.masterKey);
  assert.equal(value.keyParams.identifier, "test@example.com");
  assert.equal(calls.length, 2);
  assert.equal(
    calls[0].body.code_challenge,
    authChallenge(calls[1].body.code_verifier),
  );
  assert.equal(calls[1].body.password, keys.serverPassword);
  assert.ok(
    calls.every(
      (call) =>
        call.request.redirect === "error" &&
        !call.request.body.includes("private-password"),
    ),
  );
  await assert.rejects(transport.request("POST", "/v1/items"), {
    code: "forbidden_endpoint",
  });
  await assert.rejects(transport.request("POST", "/v1/users"), {
    code: "forbidden_endpoint",
  });
  assert.equal(calls.length, 2);
});

test("MFA challenge retries with fresh verifier; wrong password, captcha and security-key states remain distinct", async () => {
  let requests = 0,
    prompts = 0;
  const transport = new StandardNotesAuthTransport({
    derive: async () => ({ ...keys }),
    fetch: async (url, request) => {
      requests++;
      if (requests === 1)
        return response({ error: { tag: "mfa-required" } }, 401);
      if (url.endsWith("login-params")) {
        assert.equal(JSON.parse(request.body).mfa_code, "123456");
        return response(params);
      }
      return response(
        { error: { message: "do not reflect untrusted details" } },
        401,
      );
    },
  });
  await assert.rejects(
    transport.signIn({
      email: "test@example.com",
      password: "password",
      requestMfa: async () => {
        prompts++;
        return "123456";
      },
    }),
    { code: "credentials_rejected" },
  );
  assert.equal(prompts, 1);
  assert.equal(requests, 3);
  transport.fetch = async () =>
    response({ error: {} }, 401, {
      "x-captcha-required": "https://untrusted.invalid/challenge",
    });
  await assert.rejects(transport.request("POST", "/v2/login"), {
    code: "verification_required",
  });
  transport.fetch = async () =>
    response({ error: { tag: "u2f-required" } }, 401);
  await assert.rejects(transport.request("POST", "/v2/login"), {
    code: "security_key_required",
  });
});

test("session cookies are retained securely, validated as a pair and refresh cookie is endpoint-scoped", async () => {
  const cookies = [
    "access_token_id=real-access; Path=/; HttpOnly; Secure",
    "refresh_token_id=real-refresh; Path=/v1/sessions/refresh; HttpOnly; Secure",
  ];
  const v2 = {
    ...account(),
    session: {
      ...session,
      access_token: "2:selector",
      refresh_token: "2:selector",
      cookies,
    },
  };
  const stored = parseStoredAccount(JSON.stringify(v2));
  assert.equal(stored.session.cookies.length, 2);
  assert.equal(
    parseStoredAccount(
      JSON.stringify({ ...v2, session: { ...v2.session, cookies: [] } }),
    ),
    undefined,
  );
  assert.equal(
    parseStoredAccount(
      JSON.stringify({ ...v2, server: "https://evil.invalid" }),
    ),
    undefined,
  );
  const calls = [];
  const transport = new StandardNotesAuthTransport({
    fetch: async (url, request) => {
      calls.push({ url, request });
      if (url.endsWith("/refresh")) {
        const headers = new Headers();
        for (const cookie of cookies)
          headers.append("Set-Cookie", cookie.replace("real-", "rotated-"));
        return response({ data: { session: v2.session } }, 200, headers);
      }
      if (url.endsWith("/logout")) return response(null, 204);
      return response({ data: [] });
    },
  });
  await transport.check(stored);
  assert.equal(calls[0].request.headers.Cookie, "access_token_id=real-access");
  const refreshed = await transport.refresh(stored);
  assert.deepEqual(refreshed.session.cookies, [
    "access_token_id=rotated-access",
    "refresh_token_id=rotated-refresh",
  ]);
  assert.equal(calls[1].request.headers.Authorization, "Bearer 2:selector");
  assert.match(calls[1].request.headers.Cookie, /refresh_token_id/u);
  assert.equal(JSON.parse(calls[1].request.body).api, "20200115");
  await transport.signOut(refreshed);
  assert.doesNotMatch(calls[2].request.headers.Cookie, /refresh_token/u);
});

test("transport bounds response data and distinguishes cancellation while reading the body", async () => {
  const transport = new StandardNotesAuthTransport({
    fetch: async () => response({ data: "a".repeat(600000) }),
  });
  await assert.rejects(transport.request("GET", "/v1/sessions"), {
    code: "invalid_response",
  });
  const abort = new AbortController();
  transport.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          abort.abort();
          controller.error(new Error("aborted body"));
        },
      }),
    );
  await assert.rejects(
    transport.request("GET", "/v1/sessions", { signal: abort.signal }),
    { code: "canceled" },
  );
});

function serviceHarness(initial) {
  const stored = new Map(
      initial ? [[AUTH_SECRET_KEY, JSON.stringify(initial)]] : [],
    ),
    states = [],
    calls = [];
  const secrets = {
    get: async (key) => stored.get(key),
    store: async (key, value) => {
      stored.set(key, value);
    },
    delete: async (key) => stored.delete(key),
  };
  const transport = {
    signIn: async () => {
      calls.push("login");
      return account();
    },
    check: async () => {
      calls.push("check");
    },
    refresh: async (value) => {
      calls.push("refresh");
      return { ...value, session: { ...session, access_token: "1:renewed" } };
    },
    signOut: async () => {
      calls.push("logout");
    },
  };
  const service = new StandardNotesAccount({
    secrets,
    transport,
    onChange: (state) => states.push(state),
    now: () => 1900000000000,
  });
  return { service, secrets, transport, stored, states, calls };
}
const credentials = async () => ({
  email: "test@example.com",
  password: "never-stored",
});

test("connected requires verified token and secure persistence; public state never contains secrets", async () => {
  const h = serviceHarness();
  await h.service.signIn(credentials, async () => "123456");
  assert.deepEqual(h.calls, ["login", "check"]);
  assert.equal(h.service.state.status, "connected");
  assert.equal(h.service.state.syncEnabled, false);
  assert.doesNotMatch(
    JSON.stringify(h.states),
    /masterKey|access_token|refresh_token|never-stored/u,
  );
  assert.doesNotMatch(
    h.stored.get(AUTH_SECRET_KEY),
    /never-stored|serverPassword/u,
  );
  assert.ok(!AUTH_SECRET_KEY.startsWith("aicNotes.standardNotes."));
});

test("secure storage failure cannot yield connected; newly issued session is revoked", async () => {
  const h = serviceHarness();
  h.secrets.store = async () => {
    throw new Error("vault unavailable");
  };
  await h.service.signIn(credentials, async () => "123456");
  assert.equal(h.service.state.status, "storage-unavailable");
  assert.equal(h.calls.at(-1), "logout");
  assert.ok(h.states.every((state) => state.status !== "connected"));
});

test("restore verifies saved session, refreshes expiration, preserves secrets offline and exposes revocation", async () => {
  const h = serviceHarness({
    ...account(),
    session: { ...session, access_expiration: 1800000000000 },
  });
  await h.service.restore();
  assert.deepEqual(h.calls, ["refresh", "check"]);
  assert.equal(h.service.state.status, "connected");
  h.transport.check = async () => {
    throw new StandardNotesAuthError("network_error");
  };
  await h.service.check();
  assert.equal(h.service.state.status, "offline");
  assert.ok(h.stored.has(AUTH_SECRET_KEY));
  h.transport.check = async () => {
    throw new StandardNotesAuthError("credentials_rejected", 401);
  };
  await h.service.check();
  assert.equal(h.service.state.status, "reauth-required");
});

test("sign-out clears secure local state even offline; late login cannot resurrect session", async () => {
  const h = serviceHarness(account());
  await h.service.restore();
  h.transport.signOut = async () => {
    throw new StandardNotesAuthError("network_error");
  };
  await h.service.signOut();
  assert.equal(h.stored.size, 0);
  assert.equal(h.service.state.status, "signed-out");
  assert.equal(h.service.state.issue, "remote_logout_unconfirmed");
  const other = serviceHarness();
  let release;
  other.transport.signIn = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = other.service.signIn(credentials, async () => "123456");
  await new Promise((resolve) => setImmediate(resolve));
  const signingOut = other.service.signOut();
  release(account());
  await pending;
  await signingOut;
  assert.equal(other.stored.size, 0);
  assert.equal(other.service.state.status, "signed-out");
  assert.ok(other.calls.includes("logout"));
});

test("canceling credential prompt makes no network request and remains quiet", async () => {
  const h = serviceHarness();
  await h.service.signIn(async () => undefined);
  assert.equal(h.calls.length, 0);
  assert.equal(h.service.state.status, "signed-out");
  assert.equal(h.service.state.issue, undefined);
});

test("silent storage failure cannot yield connected", async () => {
  const h = serviceHarness();
  h.secrets.store = async () => {};
  await h.service.signIn(credentials);
  assert.equal(h.service.state.status, "storage-unavailable");
  assert.ok(h.calls.includes("logout"));
});

test("a rotated session remains current when its subsequent verification is offline", async () => {
  const h = serviceHarness({
    ...account(),
    session: { ...session, access_expiration: 1800000000000 },
  });
  h.transport.check = async (value) => {
    assert.equal(value.session.access_token, "1:renewed");
    throw new StandardNotesAuthError("network_error");
  };
  await h.service.restore();
  await h.service.check();
  assert.equal(h.calls.filter((value) => value === "refresh").length, 1);
  assert.equal(h.service.state.status, "offline");
});

test("duplicate logout and connection check cannot cancel remote revocation", async () => {
  const h = serviceHarness(account());
  await h.service.restore();
  let finish;
  h.transport.signOut = (value, signal) =>
    new Promise((resolve) => {
      finish = () => {
        assert.equal(signal.aborted, false);
        resolve();
      };
    });
  const first = h.service.signOut();
  await new Promise((resolve) => setImmediate(resolve));
  await h.service.signOut();
  await h.service.check();
  finish();
  await first;
  assert.equal(h.service.state.status, "signed-out");
  assert.equal(h.service.state.issue, undefined);
});

test("logout during initial restore still revokes the stored session", async () => {
  const h = serviceHarness(account());
  const get = h.secrets.get;
  let finish,
    first = true;
  h.secrets.get = (key) => {
    if (!first) return get(key);
    first = false;
    return new Promise((resolve) => {
      finish = () => resolve(JSON.stringify(account()));
    });
  };
  const pending = h.service.restore();
  await h.service.signOut();
  finish();
  await pending;
  assert.deepEqual(h.calls, ["logout"]);
  assert.equal(h.stored.size, 0);
  assert.equal(h.service.state.status, "signed-out");
});

test("other-window secret changes retire stale account state; own notifications are quiet", async () => {
  const h = serviceHarness();
  await h.service.signIn(credentials);
  await h.service.secretChanged();
  assert.deepEqual(h.calls, ["login", "check"]);
  h.stored.delete(AUTH_SECRET_KEY);
  await h.service.secretChanged();
  assert.equal(h.service.state.status, "signed-out");
  const changed = account();
  changed.user.email = "second@example.com";
  h.stored.set(AUTH_SECRET_KEY, JSON.stringify(changed));
  await h.service.secretChanged();
  assert.equal(h.service.state.email, "second@example.com");
  assert.equal(h.service.state.status, "connected");
});

test("two windows cannot overwrite sign-out with a concurrent refresh", async () => {
  let held = false;
  const acquireLock = async () => {
    if (held) throw new StandardNotesAuthError("account_busy");
    held = true;
    return async () => {
      held = false;
    };
  };
  const h = serviceHarness(account());
  h.service.acquireLock = acquireLock;
  await h.service.restore();
  const other = new StandardNotesAccount({
    secrets: h.secrets,
    transport: h.transport,
    acquireLock,
    now: () => 1900000000000,
  });
  await other.restore();
  const expired = account();
  expired.session.access_expiration = 1800000000000;
  h.stored.set(AUTH_SECRET_KEY, JSON.stringify(expired));
  let finish;
  h.transport.refresh = (value) =>
    new Promise((resolve) => {
      finish = () =>
        resolve({
          ...value,
          session: { ...session, access_token: "1:renewed" },
        });
    });
  const checking = h.service.check();
  await new Promise((resolve) => setImmediate(resolve));
  await other.signOut();
  assert.equal(other.state.issue, "account_busy");
  assert.ok(h.stored.has(AUTH_SECRET_KEY));
  finish();
  await checking;
  await other.signOut();
  assert.equal(h.stored.size, 0);
  // Even before its secret-change notification, the stale window must reload under its lease.
  await h.service.check();
  assert.equal(h.service.state.status, "signed-out");
  assert.equal(h.stored.size, 0);
});
