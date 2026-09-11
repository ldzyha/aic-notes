import {
  StandardNotesAuthError,
  authDiagnostic,
  parseStoredAccount,
} from "./standard-notes-transport.js";

// Separate namespace from the removed sync runtime and its cleanup migration.
export const AUTH_SECRET_KEY = "aicNotes.snAuth.session.v1";

export class StandardNotesAccount {
  constructor({
    secrets,
    transport,
    acquireLock = async () => async () => {},
    onChange = () => {},
    now = Date.now,
  }) {
    this.secrets = secrets;
    this.transport = transport;
    this.acquireLock = acquireLock;
    this.onChange = onChange;
    this.now = now;
    this.epoch = 0;
    this.writeQueue = Promise.resolve();
    this.state = { status: "signed-out", syncEnabled: false };
  }

  publish(status, issue, error) {
    const diagnostic = authDiagnostic(error);
    this.state = {
      status,
      syncEnabled: false,
      ...(this.account ? { email: this.account.user.email } : {}),
      ...(issue ? { issue } : {}),
      ...(diagnostic ? { diagnostic } : {}),
    };
    this.onChange(this.state);
  }

  begin(status) {
    this.abort?.abort();
    this.abort = new AbortController();
    const epoch = ++this.epoch;
    this.publish(status);
    return { epoch, signal: this.abort.signal };
  }

  async lock(epoch) {
    const release = await this.acquireLock(() => {
      if (epoch === this.epoch) {
        this.epoch++;
        this.abort?.abort();
        this.publish("reauth-required", "account_coordination_unavailable");
      }
    });
    if (epoch !== this.epoch) {
      await release();
      throw new StandardNotesAuthError("canceled");
    }
    let finished;
    this.lockReleased = new Promise((resolve) => {
      finished = resolve;
    });
    return async () => {
      try {
        await release();
      } catch {
        if (epoch === this.epoch)
          this.publish(
            this.account ? "offline" : "signed-out",
            "account_coordination_unavailable",
          );
      } finally {
        finished();
      }
    };
  }

  async loadLatest(epoch) {
    let raw;
    try {
      raw = await this.secrets.get(AUTH_SECRET_KEY);
    } catch {
      throw new StandardNotesAuthError("secure_storage_unavailable");
    }
    if (epoch !== this.epoch) throw new StandardNotesAuthError("canceled");
    this.storedValue = raw;
    this.account = raw ? parseStoredAccount(raw) : undefined;
    if (raw && !this.account)
      throw new StandardNotesAuthError("invalid_saved_session");
    return this.account;
  }

  async store(value, epoch) {
    const write = this.writeQueue
      .catch(() => {})
      .then(async () => {
        if (epoch !== this.epoch) return false;
        this.writing = true;
        try {
          const serialized =
            value === undefined ? undefined : JSON.stringify(value);
          if (serialized === undefined)
            await this.secrets.delete(AUTH_SECRET_KEY);
          else await this.secrets.store(AUTH_SECRET_KEY, serialized);
          if ((await this.secrets.get(AUTH_SECRET_KEY)) !== serialized)
            throw new Error("secure storage verification failed");
          this.storedValue = serialized;
        } catch {
          throw new StandardNotesAuthError("secure_storage_unavailable");
        } finally {
          this.writing = false;
        }
        return epoch === this.epoch;
      });
    this.writeQueue = write;
    return write;
  }

  async restore() {
    const { epoch } = this.begin("checking");
    try {
      const raw = await this.secrets.get(AUTH_SECRET_KEY);
      if (epoch !== this.epoch) return;
      this.storedValue = raw;
      this.account = raw ? parseStoredAccount(raw) : undefined;
      if (raw && !this.account)
        this.publish("reauth-required", "invalid_saved_session");
      else if (!this.account) this.publish("signed-out");
      else return this.check(true);
    } catch {
      if (epoch === this.epoch) {
        this.account = undefined;
        this.publish("storage-unavailable", "secure_storage_unavailable");
      }
    }
  }

  async secretChanged() {
    // VS Code shares SecretStorage across windows. Ignore our own notifications,
    // but retire in-flight work when another window signs out or replaces a session.
    await this.writeQueue.catch(() => {});
    if (this.disposed) return;
    try {
      const raw = await this.secrets.get(AUTH_SECRET_KEY);
      if (!this.disposed && raw !== this.storedValue) await this.restore();
    } catch {
      if (!this.disposed)
        this.publish("storage-unavailable", "secure_storage_unavailable");
    }
  }

  async signIn(getCredentials, requestMfa) {
    if (["signing-in", "signing-out", "checking"].includes(this.state.status))
      return;
    if (this.account && ["connected", "offline"].includes(this.state.status))
      return;
    const { epoch, signal } = this.begin("signing-in");
    let issued, release;
    try {
      release = await this.lock(epoch);
      // Fail before asking for a password if this host has no secure secret facility.
      if (!this.secrets?.get || !this.secrets?.store || !this.secrets?.delete)
        throw new StandardNotesAuthError("secure_storage_unavailable");
      try {
        await this.secrets.get(AUTH_SECRET_KEY);
      } catch {
        throw new StandardNotesAuthError("secure_storage_unavailable");
      }
      const credentials = await getCredentials(signal);
      if (!credentials || signal.aborted)
        throw new StandardNotesAuthError("canceled");
      try {
        issued = await this.transport.signIn({
          ...credentials,
          requestMfa: (retry) => requestMfa(retry, signal),
          signal,
        });
      } finally {
        credentials.password = "";
      }
      // A login response alone is not enough: prove its token can authenticate without reading notes.
      await this.transport.check(issued, signal);
      if (epoch !== this.epoch) throw new StandardNotesAuthError("canceled");
      if (!(await this.store(issued, epoch)))
        throw new StandardNotesAuthError("canceled");
      this.account = issued;
      issued = undefined;
      this.publish("connected");
    } catch (error) {
      // Roll back only this newly issued session, never the user's other sessions.
      if (issued) {
        try {
          await this.transport.signOut(issued);
        } catch {
          /* Best effort; no note access. */
        }
      }
      if (epoch !== this.epoch) return;
      const code =
        error instanceof StandardNotesAuthError
          ? error.code
          : signal.aborted
            ? "canceled"
            : "authentication_failed";
      if (code === "secure_storage_unavailable")
        this.publish("storage-unavailable", code, error);
      else
        this.publish(
          this.account ? "reauth-required" : "signed-out",
          code === "canceled" ? undefined : code,
          code === "canceled" ? undefined : error,
        );
    } finally {
      await release?.();
    }
  }

  async check(restoring = false) {
    if (
      !restoring &&
      ["signing-in", "signing-out", "checking"].includes(this.state.status)
    )
      return;
    if (!this.account) {
      this.publish("signed-out");
      return;
    }
    const { epoch, signal } = this.begin("checking");
    let account, release;
    try {
      release = await this.lock(epoch);
      account = await this.loadLatest(epoch);
      if (!account) {
        this.publish("signed-out");
        return;
      }
      if (account.session.refresh_expiration <= this.now())
        throw new StandardNotesAuthError("session_expired");
      if (account.session.access_expiration <= this.now() + 30000) {
        account = await this.transport.refresh(account, signal);
        if (!(await this.store(account, epoch))) return;
        this.account = account;
      }
      try {
        await this.transport.check(account, signal);
      } catch (error) {
        if (error.status !== 498) throw error;
        account = await this.transport.refresh(account, signal);
        if (!(await this.store(account, epoch))) return;
        this.account = account;
        await this.transport.check(account, signal);
      }
      if (epoch !== this.epoch) return;
      this.account = account;
      this.publish("connected");
    } catch (error) {
      if (epoch !== this.epoch) return;
      // Keep valid local key material on network failure; do not claim a verified connection.
      if (
        [
          "network_error",
          "server_error",
          "rate_limited",
          "account_busy",
        ].includes(error.code)
      )
        this.publish("offline", error.code, error);
      else if (error.code === "secure_storage_unavailable")
        this.publish("storage-unavailable", error.code, error);
      else
        this.publish("reauth-required", error.code ?? "session_expired", error);
    } finally {
      await release?.();
    }
  }

  async signOut() {
    if (this.state.status === "signing-out") return;
    let account;
    const { epoch, signal } = this.begin("signing-out");
    let issue, release;
    try {
      // Cancel this window's pending prompt/request and wait for its lease cleanup.
      await this.lockReleased;
      release = await this.lock(epoch);
      // Re-read under the same inter-window lease as deletion, not a stale memory copy.
      try {
        account = await this.loadLatest(epoch);
      } catch (error) {
        if (error.code !== "invalid_saved_session") throw error;
        issue = "remote_logout_unconfirmed";
      }
      if (!(await this.store(undefined, epoch))) return;
      this.account = undefined;
      if (account) {
        try {
          await this.transport.signOut(account, signal);
        } catch {
          issue = "remote_logout_unconfirmed";
        }
      }
      if (epoch === this.epoch) this.publish("signed-out", issue);
    } catch (error) {
      if (epoch === this.epoch)
        this.publish(
          error.code === "account_busy"
            ? this.account
              ? "offline"
              : "signed-out"
            : "storage-unavailable",
          error.code ?? "secure_storage_unavailable",
        );
    } finally {
      await release?.();
    }
  }

  dispose() {
    this.disposed = true;
    this.epoch++;
    this.abort?.abort();
    this.account = undefined;
    this.storedValue = undefined;
    this.onChange = () => {};
  }
}
