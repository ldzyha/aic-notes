import { DEFAULT_NOTE_BODY_TEMPLATE } from "../../vendor/aic-editor-core/note-template.js";

// Core-guided new notes start with noise research and evolve in place into
// wave instructions. Existing note bodies and project template overrides
// remain owned by the user; this module supplies defaults only.

export const TEMPLATE_PATHS = {
  "file-note": ".aic/templates/file-note.md",
  "folder-note": ".aic/templates/folder-note.md",
  "project-note": ".aic/templates/project-note.md",
};

// Fill {{name}}, then drop every line that still carries an unfilled token.
// Collapses the runs of blank lines the dropped lines leave behind.
export function fillTemplate(template, name) {
  const filled = template.replaceAll("{{name}}", name);
  const lines = filled
    .split("\n")
    .filter((l) => !/\{\{[a-zA-Z0-9_]+\}\}/.test(l));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Resolve the template for a level: the project override wins when it exists
// and contains at least one {{token}} (same acceptance rule as aic's
// loadTemplate); otherwise the built-in default. `readFile` is an async
// (relPath) => string|null supplied by the caller (workspace.fs there,
// node fs in unit tests).
export async function loadTemplate(level, readFile) {
  const fallback = DEFAULT_NOTE_BODY_TEMPLATE;
  const path = TEMPLATE_PATHS[level];
  if (!path) return fallback;
  try {
    const t = await readFile(path);
    if (t && t.includes("{{")) return t;
  } catch {
    /* no override */
  }
  return fallback;
}
