// Note frontmatter — vendored verbatim from aic
// modules/notes/web/src/lazy/sync.js (parseFrontmatter / stringifyFrontmatter /
// isAgentVisible / noteMeta). Line-based `key: value` only; multiline values do
// not round-trip (which is why aic omits `ai:` from seeded headers).

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

export function parseFrontmatter(text) {
  const m = FRONTMATTER_RE.exec(text || "");
  if (!m) return { text: text || "", meta: {} };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^\d+$/.test(val)) val = Number(val);
    meta[key] = val;
  }
  return { text: text.slice(m[0].length), meta };
}

export function stringifyFrontmatter(text, meta) {
  const keys = Object.keys(meta);
  if (!keys.length) return text;
  const lines = ["---"];
  for (const k of keys) lines.push(`${k}: ${meta[k]}`);
  lines.push("---");
  const prefix = lines.join("\n") + "\n";
  return prefix + (text.startsWith("\n") ? text.slice(1) : text);
}

export function isAgentVisible(text) {
  const { meta } = parseFrontmatter(text);
  if (meta.agent === false || meta.private === true || meta.visibility === "private") return false;
  return true;
}

// the DOCS_CONVENTION props header: title/level/scope/status/updated + the
// machine keys created/agent. `scope` stays EMPTY — an invitation to fill the
// one-line document description.
export function noteMeta(title, level) {
  const today = new Date().toISOString().slice(0, 10);
  return { title, level, scope: "", status: "live", updated: today, created: today, agent: true };
}
