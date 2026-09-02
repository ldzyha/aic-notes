const PASSIVE_DISCONNECTIONS = Object.freeze({
  sn_not_connected: Object.freeze({
    connected: false,
    reconnect: false,
    available: true,
  }),
  sn_vault_unreadable: Object.freeze({
    connected: false,
    reconnect: true,
    available: true,
  }),
  sn_vault_unavailable: Object.freeze({
    connected: false,
    reconnect: false,
    available: false,
  }),
});

export function syncErrorCode(error) {
  return String(error?.structured?.error ?? error?.code ?? "");
}

// Missing authorization and an unavailable local vault are ordinary passive
// states. Background initialization and Ctrl+S synchronization must not turn
// either into error notifications. Explicit login still surfaces its errors.
export function passiveConnectionState(error) {
  return PASSIVE_DISCONNECTIONS[syncErrorCode(error)] ?? null;
}

export function disconnectedSyncResult(error) {
  const state = passiveConnectionState(error);
  return state
    ? Object.freeze({
        action: "disconnected",
        skipped: true,
        reconnect: state.reconnect,
        available: state.available,
      })
    : null;
}
