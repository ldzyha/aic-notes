import { createHash, randomBytes } from "node:crypto";
import { argon2idAsync } from "@noble/hashes/argon2.js";

export const STANDARD_NOTES_SERVER = "https://api.standardnotes.com";
const API = "20200115";
const ENDPOINTS = new Set([
  "POST /v2/login-params",
  "POST /v2/login",
  "GET /v1/sessions",
  "POST /v1/sessions/refresh",
  "POST /v1/logout",
]);
const MAX_RESPONSE = 512 * 1024;
const STAGES = {
  "/v2/login-params": "login-params",
  "/v2/login": "login",
  "/v1/sessions": "session-check",
  "/v1/sessions/refresh": "session-refresh",
  "/v1/logout": "logout",
};
const REASONS = new Set([
  "invalid-json",
  "response-too-large",
  "key-params",
  "user",
  "session-tokens",
  "session-expiration",
  "session-cookies",
  "session-list",
  "http-status",
  "network",
  "canceled",
]);
const hash = (text) => createHash("sha256").update(text, "utf8").digest("hex");
let derivationQueue = Promise.resolve();

// Only fixed protocol labels may leave the transport. Never expose response
// bodies, header values, account identifiers or arbitrary Error.message text.
export function authDiagnostic(error) {
  const stage = error?.diagnostic?.stage;
  if (!Object.values(STAGES).includes(stage)) return undefined;
  const reason = error.diagnostic.reason;
  const status = error.status;
  return Object.freeze({
    stage,
    ...(REASONS.has(reason) ? { reason } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599
      ? { status }
      : {}),
  });
}

export class StandardNotesAuthError extends Error {
  constructor(code, status = 0, diagnostic) {
    super(code);
    this.name = "StandardNotesAuthError";
    this.code = code;
    this.status = status;
    const safe = authDiagnostic({ status, diagnostic });
    if (safe) this.diagnostic = safe;
  }
}

function invalidResponse(stage, reason, status = 0) {
  return new StandardNotesAuthError("invalid_response", status, {
    stage,
    reason,
  });
}

function checkedKeyParams(params) {
  if (
    !params ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    typeof params.version !== "string"
  )
    throw invalidResponse("login-params", "key-params");
  if (params.version !== "004")
    throw new StandardNotesAuthError("unsupported_protocol", 0, {
      stage: "login-params",
      reason: "key-params",
    });
  if (
    typeof params.pw_nonce !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(params.pw_nonce)
  )
    throw invalidResponse("login-params", "key-params");
  return params;
}

// Standard Notes PKCE encodes the UTF-8 HEX digest, not the raw SHA-256 bytes.
export function authChallenge(verifier) {
  return Buffer.from(hash(verifier), "utf8").toString("base64url");
}

export function deriveAuthKeys(email, password, params, signal) {
  // Cancel/retry cannot accumulate multiple 64 MiB KDF matrices in one host.
  const result = derivationQueue
    .catch(() => {})
    .then(() => deriveKeys(email, password, params, signal));
  derivationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function deriveKeys(email, password, params, signal) {
  checkedKeyParams(params);
  signal?.throwIfAborted();
  const salt = Buffer.from(
    hash(`${email}:${params.pw_nonce}`).slice(0, 32),
    "hex",
  );
  const passwordBytes = Buffer.from(password, "utf8");
  let derived;
  try {
    derived = await argon2idAsync(passwordBytes, salt, {
      t: 5,
      m: 65536,
      p: 1,
      dkLen: 64,
      version: 0x13,
      asyncTick: 10,
      // Let the finite KDF finish its own matrix cleanup if canceled mid-derivation.
      // A callback exception would bypass noble's cleanup. The check below prevents login.
    });
    signal?.throwIfAborted();
    return {
      masterKey: Buffer.from(derived.subarray(0, 32)).toString("hex"),
      serverPassword: Buffer.from(derived.subarray(32)).toString("hex"),
    };
  } finally {
    passwordBytes.fill(0);
    salt.fill(0);
    derived?.fill(0);
  }
}

function responseCookies(headers) {
  const result = [];
  const separate = headers?.getSetCookie?.() ?? [];
  const combined = separate.length ? undefined : headers?.get?.("set-cookie");
  for (const header of separate.length
    ? separate
    : combined
      ? [combined]
      : []) {
    // Electron can fold multiple Set-Cookie values into one header. A comma
    // inside Expires is not a boundary unless followed by an auth cookie name.
    if (typeof header !== "string" || /[\r\n]/u.test(header)) continue;
    for (const match of header.matchAll(
      /(?:^|,\s*)((?:access|refresh)_token(?:_[A-Za-z0-9-]+)?=[^\s;,\r\n]+)/gu,
    )) {
      if (match[1].length < 8192) result.push(match[1]);
    }
  }
  return result;
}

function checkedSession(raw, cookies = [], stage = "login") {
  if (
    !raw ||
    ![raw.access_token, raw.refresh_token].every(
      (value) =>
        typeof value === "string" &&
        value.length > 5 &&
        value.length < 8192 &&
        !/[\r\n]/u.test(value),
    )
  )
    throw invalidResponse(stage, "session-tokens");
  if (
    ![raw.access_expiration, raw.refresh_expiration].every(
      (value) =>
        Number.isFinite(value) && value > 0 && value < 8640000000000000,
    )
  )
    throw invalidResponse(stage, "session-expiration");
  if (raw.access_token.startsWith("2:") || raw.refresh_token.startsWith("2:")) {
    if (raw.access_token !== raw.refresh_token)
      throw invalidResponse(stage, "session-cookies");
    const access = cookies.find((cookie) => cookie.startsWith("access_token_"));
    const refresh = cookies.find((cookie) =>
      cookie.startsWith("refresh_token_"),
    );
    if (
      cookies.length !== 2 ||
      !access ||
      !refresh ||
      access.slice(13).split("=")[0] !== refresh.slice(14).split("=")[0]
    )
      throw invalidResponse(stage, "session-cookies");
  } else cookies = [];
  return {
    access_token: raw.access_token,
    refresh_token: raw.refresh_token,
    access_expiration: raw.access_expiration,
    refresh_expiration: raw.refresh_expiration,
    readonly_access: Boolean(raw.readonly_access),
    cookies,
  };
}

/** Auth-only boundary. No /items, notes, tags, sync, account creation or recovery endpoints. */
export class StandardNotesAuthTransport {
  constructor({ fetch = globalThis.fetch, derive = deriveAuthKeys } = {}) {
    this.fetch = fetch;
    this.derive = derive;
  }

  async request(method, endpoint, { body, session, signal } = {}) {
    if (!ENDPOINTS.has(`${method} ${endpoint}`))
      throw new StandardNotesAuthError("forbidden_endpoint");
    const stage = STAGES[endpoint];
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Application-Version": "AIC-Notes-auth-1",
    };
    if (session) {
      headers.Authorization = `Bearer ${session.access_token}`;
      const cookies = session.cookies?.filter(
        (cookie) =>
          cookie.startsWith("access_token") ||
          endpoint === "/v1/sessions/refresh",
      );
      if (cookies?.length) headers.Cookie = cookies.join("; ");
    }
    const requestSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    let response;
    try {
      response = await this.fetch(`${STANDARD_NOTES_SERVER}${endpoint}`, {
        method,
        headers,
        redirect: "error",
        signal: requestSignal,
        ...(body === undefined
          ? {}
          : { body: JSON.stringify({ api: API, ...body }) }),
      });
    } catch {
      if (signal?.aborted)
        throw new StandardNotesAuthError("canceled", 0, { stage });
      throw new StandardNotesAuthError("network_error", 0, { stage });
    }
    const httpError = (error) => {
      const tags = {
        "mfa-required": "mfa_required",
        "mfa-invalid": "mfa_required",
        "u2f-required": "security_key_required",
        "hvm-required": "verification_required",
        "human-verification-required": "verification_required",
      };
      return new StandardNotesAuthError(
        response.headers?.has?.("x-captcha-required")
          ? "verification_required"
          : Object.hasOwn(tags, error?.tag ?? "")
            ? tags[error.tag]
            : response.status === 429
              ? "rate_limited"
              : [401, 403, 498, 499].includes(response.status)
                ? "credentials_rejected"
                : "server_error",
        response.status,
        { stage, reason: "http-status" },
      );
    };
    let data;
    try {
      const reader = response.body?.getReader();
      if (reader) {
        const chunks = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > MAX_RESPONSE) {
              await reader.cancel();
              throw invalidResponse(
                stage,
                "response-too-large",
                response.status,
              );
            }
            chunks.push(value);
          }
          // Match Fetch's UTF-8 decoding, including stripping a leading BOM.
          const raw = new TextDecoder().decode(Buffer.concat(chunks));
          data = raw ? JSON.parse(raw) : {};
        } finally {
          reader.releaseLock();
        }
      } else data = response.status === 204 ? {} : await response.json();
    } catch (error) {
      if (signal?.aborted)
        throw new StandardNotesAuthError("canceled", 0, { stage });
      if (requestSignal.aborted)
        throw new StandardNotesAuthError("network_error", 0, { stage });
      // A proxy/rate limiter may return HTML. Keep the actionable HTTP status
      // instead of incorrectly labelling it an unsupported auth protocol.
      if (!response.ok || response.headers?.has?.("x-captcha-required"))
        throw httpError();
      if (error instanceof StandardNotesAuthError) throw error;
      throw invalidResponse(stage, "invalid-json", response.status);
    }
    const payload = data?.data ?? data;
    const error = payload?.error ?? data?.error;
    if (!response.ok || error || response.headers?.has?.("x-captcha-required"))
      throw httpError(error);
    return { data: payload, cookies: responseCookies(response.headers) };
  }

  async signIn(options) {
    try {
      return await this.signInOnce(options);
    } catch (error) {
      const cleaned = options.email?.trim().toLowerCase();
      if (
        error.code === "credentials_rejected" &&
        cleaned &&
        cleaned !== options.email
      )
        return this.signInOnce({ ...options, email: cleaned });
      throw error;
    }
  }

  async signInOnce({ email, password, requestMfa, signal }) {
    if (
      typeof email !== "string" ||
      !email.trim() ||
      email.length > 320 ||
      typeof password !== "string" ||
      !password ||
      password.length > 4096
    )
      throw new StandardNotesAuthError("invalid_input");
    // Preserve the supplied identifier for derivation. Do not trust an identifier returned by the server.
    let mfaCode;
    let params, verifier;
    for (let attempt = 0; attempt < 4; attempt++) {
      verifier = randomBytes(32).toString("hex");
      try {
        const response = await this.request("POST", "/v2/login-params", {
          body: {
            email,
            code_challenge: authChallenge(verifier),
            ...(mfaCode ? { mfa_code: mfaCode } : {}),
          },
          signal,
        });
        params = checkedKeyParams(response.data);
        break;
      } catch (error) {
        if (error.code !== "mfa_required" || attempt === 3 || !requestMfa)
          throw error;
        mfaCode = await requestMfa(attempt > 0);
        if (!mfaCode) throw new StandardNotesAuthError("canceled");
      }
    }
    signal?.throwIfAborted();
    const keys = await this.derive(email, password, params, signal);
    try {
      const response = await this.request("POST", "/v2/login", {
        body: {
          email,
          password: keys.serverPassword,
          ephemeral: false,
          code_verifier: verifier,
        },
        signal,
      });
      const user = response.data?.user;
      if (
        typeof user?.uuid !== "string" ||
        !user.uuid ||
        typeof user?.email !== "string" ||
        !user.email
      )
        throw invalidResponse("login", "user");
      return {
        schema: 1,
        server: STANDARD_NOTES_SERVER,
        user: { uuid: user.uuid, email: user.email },
        session: checkedSession(response.data.session, response.cookies),
        masterKey: keys.masterKey,
        keyParams: {
          identifier: email,
          version: "004",
          pw_nonce: params.pw_nonce,
        },
      };
    } finally {
      keys.serverPassword = "";
      keys.masterKey = "";
    }
  }

  async check(account, signal) {
    const response = await this.request("GET", "/v1/sessions", {
      session: account.session,
      signal,
    });
    if (!Array.isArray(response.data))
      throw invalidResponse("session-check", "session-list");
  }

  async refresh(account, signal) {
    const response = await this.request("POST", "/v1/sessions/refresh", {
      session: account.session,
      signal,
      body: {
        access_token: account.session.access_token,
        refresh_token: account.session.refresh_token,
      },
    });
    return {
      ...account,
      session: checkedSession(
        response.data?.session,
        response.cookies,
        "session-refresh",
      ),
    };
  }

  async signOut(account, signal) {
    await this.request("POST", "/v1/logout", {
      session: account.session,
      signal,
    });
  }
}

export function parseStoredAccount(value) {
  try {
    const account = JSON.parse(value);
    if (
      account?.schema !== 1 ||
      account.server !== STANDARD_NOTES_SERVER ||
      typeof account.user?.uuid !== "string" ||
      !account.user.uuid ||
      account.user.uuid.length > 256 ||
      typeof account.user?.email !== "string" ||
      !account.user.email ||
      account.user.email.length > 320 ||
      !/^[a-f0-9]{64}$/u.test(account.masterKey) ||
      account.keyParams?.version !== "004" ||
      typeof account.keyParams.identifier !== "string" ||
      !account.keyParams.identifier ||
      account.keyParams.identifier.length > 320 ||
      !/^[a-f0-9]{64}$/iu.test(account.keyParams.pw_nonce)
    )
      return;
    const storedCookies = account.session?.cookies;
    const cookies =
      Array.isArray(storedCookies) &&
      storedCookies.every((cookie) => typeof cookie === "string")
        ? responseCookies({ getSetCookie: () => storedCookies })
        : [];
    return {
      schema: 1,
      server: STANDARD_NOTES_SERVER,
      user: { uuid: account.user.uuid, email: account.user.email },
      session: checkedSession(account.session, cookies),
      masterKey: account.masterKey,
      keyParams: {
        identifier: account.keyParams.identifier,
        version: "004",
        pw_nonce: account.keyParams.pw_nonce,
      },
    };
  } catch {
    return undefined;
  }
}
