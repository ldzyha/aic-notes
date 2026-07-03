// Structured errors, aic-style: { error: snake_case, detail, fix: [] }.
// Never silently degrade — every failure surfaces with concrete fix steps.

export function structuredError(error, detail, fix) {
  return Object.assign(new Error(error), { structured: { error, detail, fix } });
}

// Render a structured (or plain) error into a user-facing message string.
export function formatError(e) {
  const s = e?.structured;
  if (!s) return String(e?.message ?? e);
  const fix = s.fix?.length ? ` — fix: ${s.fix.join("; ")}` : "";
  return `${s.error}: ${s.detail}${fix}`;
}
