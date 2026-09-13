// Retire only the known VS Code SecretStorage entry from the former host login.
// No account request, workspace file, note, or other secret is touched.
const RETIRED_AUTH_SECRET = "aicNotes.snAuth.session.v1";
const RETIRED_AUTH_CLEANUP_KEY = "aicNotes.migrations.standardNotesAuthRemoved.v1";

export async function removeRetiredAuthData(context) {
  try {
    if (context.globalState.get(RETIRED_AUTH_CLEANUP_KEY, false)) return;
    await context.secrets.delete(RETIRED_AUTH_SECRET);
    await context.globalState.update(RETIRED_AUTH_CLEANUP_KEY, true);
  } catch {
    // Local editing must still activate if SecretStorage is unavailable.
    // Keep the migration pending so the next activation can retry.
  }
}
