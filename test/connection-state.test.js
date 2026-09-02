import test from "node:test";
import assert from "node:assert/strict";
import {
  disconnectedSyncResult,
  passiveConnectionState,
  syncErrorCode,
} from "../src/sync/connection-state.js";

const failure = (code) => ({ structured: { error: code } });

test("passive Standard Notes disconnection states never become errors", () => {
  assert.deepEqual(passiveConnectionState(failure("sn_not_connected")), {
    connected: false,
    reconnect: false,
    available: true,
  });
  assert.deepEqual(passiveConnectionState(failure("sn_vault_unreadable")), {
    connected: false,
    reconnect: true,
    available: true,
  });
  assert.deepEqual(passiveConnectionState(failure("sn_vault_unavailable")), {
    connected: false,
    reconnect: false,
    available: false,
  });
  assert.equal(passiveConnectionState(failure("sn_sync_failed")), null);
});

test("background sync converts only passive disconnections to skipped results", () => {
  assert.deepEqual(disconnectedSyncResult(failure("sn_not_connected")), {
    action: "disconnected",
    skipped: true,
    reconnect: false,
    available: true,
  });
  assert.equal(disconnectedSyncResult(failure("sn_tls_failed")), null);
  assert.equal(syncErrorCode({ code: "sn_not_connected" }), "sn_not_connected");
});
