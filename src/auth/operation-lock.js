import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { StandardNotesAuthError } from "./standard-notes-transport.js";

const LOCK_DIRECTORY = "sn-auth-operation.lock";

/** Coordinate cooperating extension hosts that share this globalStorage directory.
 * Only an empty directory and its heartbeat timestamp are written; account secrets
 * remain in SecretStorage. The caller must stop its operation on compromise.
 */
export function createAuthOperationLock(directory) {
  const target =
    typeof directory === "string" && directory
      ? path.resolve(directory)
      : undefined;

  return async function acquire(onCompromised) {
    let compromised = false;
    let released = false;
    let unlock;
    try {
      if (!target) throw new Error("Missing coordination directory");
      await mkdir(target, { recursive: true });
      const canonical = await realpath(target);
      unlock = await lockfile.lock(canonical, {
        lockfilePath: path.join(canonical, LOCK_DIRECTORY),
        realpath: true,
        stale: 60000,
        update: 10000,
        retries: 0,
        onCompromised() {
          if (released || compromised) return;
          compromised = true;
          // A failed host callback must not become an uncaught timer exception.
          try {
            Promise.resolve(
              onCompromised?.(
                new StandardNotesAuthError("account_coordination_unavailable"),
              ),
            ).catch(() => {});
          } catch {
            /* The lease is already lost; never remove another owner's lock. */
          }
        },
      });
    } catch (error) {
      throw new StandardNotesAuthError(
        error?.code === "ELOCKED"
          ? "account_busy"
          : "account_coordination_unavailable",
      );
    }

    let releasing;
    return async function release() {
      if (releasing) return releasing;
      if (released || compromised) {
        released = true;
        return;
      }
      released = true;
      releasing = unlock().catch((error) => {
        if (["ERELEASED", "ENOTACQUIRED", "ECOMPROMISED"].includes(error?.code))
          return;
        throw new StandardNotesAuthError("account_coordination_unavailable");
      });
      return releasing;
    };
  };
}
