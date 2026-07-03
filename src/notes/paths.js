// Note path derivation — vendored verbatim from aic
// modules/notes/web/src/index.js (notePathFor / folderNotePathFor / noteSeed);
// see vendor/markdown/PROVENANCE.md for the pinned commit. The naming rules are
// the contract that keeps notes byte-compatible between aic and this extension.

// file.js → file.note.md; dotfiles and extension-less names just append
// (.env → .env.note.md, Makefile → Makefile.note.md); never a note of a note
export function notePathFor(path) {
  if (path.endsWith(".note.md")) return null;
  return path.replace(/(?<=[^/.])\.[^./]+$/, "") + ".note.md";
}

// folder sibling note: src/components → src/components.note.md.
// Append-only — NEVER strips a "." in the folder name (app.v2 →
// app.v2.note.md). The project root has no sibling (empty path) → null.
export function folderNotePathFor(path) {
  if (!path || path.endsWith(".note.md")) return null;
  return path + ".note.md";
}

// Reverse of the naming rules: what does this note annotate? Pure string
// work — existence checks (file vs folder vs orphan) are the caller's job,
// because a stripped-extension file note can point at any sibling
// `<stem>.*`. Returns { stem, dir } where stem is the note path minus
// ".note.md".
export function noteTargetStem(notePath) {
  if (!notePath.endsWith(".note.md")) return null;
  const stem = notePath.slice(0, -".note.md".length);
  const dir = stem.includes("/") ? stem.slice(0, stem.lastIndexOf("/")) : "";
  return { stem, dir };
}

// the seed of a fresh note: the DOCS_CONVENTION props header (title/level/scope/
// status/updated/created/agent) then a one line "# notes: <path>" naming what it
// is for. Key set/order matches noteMeta in frontmatter.js — aic's upgrade
// guards compare against this exact seed.
export function noteSeed(path, kind) {
  const dir = kind === "directory";
  const title = dir ? (path.split("/").pop() || path) : path.slice(path.lastIndexOf("/") + 1);
  const today = new Date().toISOString().slice(0, 10);
  const header =
    "---\n" +
    `title: ${title}\n` +
    `level: ${dir ? "folder-note" : "file-note"}\n` +
    "scope: \n" +
    "status: live\n" +
    `updated: ${today}\n` +
    `created: ${today}\n` +
    "agent: true\n" +
    "---\n";
  return `${header}# notes: ${dir ? `${path}/` : path}\n\n`;
}
