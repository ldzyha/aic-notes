// Note body templates — adapted from aic modules/notes/web/src/lazy/sync.js.
// Same default templates and the same `.aic/templates/*.md` per-project
// override; the AI seeding is gone, so every unfilled {{token}} line is
// DELETED (leaving literal tokens in a fresh note would be silent junk) —
// except {{name}}, which we can always fill.

export const TEMPLATE_PATHS = {
  "file-note": ".aic/templates/file-note.md",
  "folder-note": ".aic/templates/folder-note.md",
  "project-note": ".aic/templates/project-note.md",
};

const TEMPLATE_FRONTMATTER =
  /^---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)(?:---|\.\.\.)[ \t]*(?:(?:\r\n|\n|\r)|$)/u;

// A template contributes only note body structure. Older project templates
// sometimes contain the retired seven-field generated header; accepting it
// would make a brand-new placeholder expose more than the three managed
// properties before the first save.
export function stripTemplateFrontmatter(template) {
  return String(template ?? "").replace(TEMPLATE_FRONTMATTER, "");
}

const DEFAULT_TEMPLATES = {
  "file-note": `## Todo

- [ ]

## Open questions

- [ ]
`,
  "folder-note": `# notes: {{name}}/

## Purpose
{{purpose}}

## Decisions
{{decisions}}

## Gotchas

## Open questions
`,
  "project-note": `# {{name}}

## Purpose
{{purpose}}

## Standards

## Decisions

## Links

## Open questions
`,
};

// Fill {{name}}, then drop every line that still carries an unfilled token.
// Collapses the runs of blank lines the dropped lines leave behind.
export function fillTemplate(template, name) {
  const filled = template.replaceAll("{{name}}", name);
  const lines = filled.split("\n").filter((l) => !/\{\{[a-zA-Z0-9_]+\}\}/.test(l));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Resolve the template for a level: the project override wins when it exists
// and contains at least one {{token}} (same acceptance rule as aic's
// loadTemplate); otherwise the built-in default. `readFile` is an async
// (relPath) => string|null supplied by the caller (workspace.fs there,
// node fs in unit tests).
export async function loadTemplate(level, readFile) {
  const fallback = DEFAULT_TEMPLATES[level] ?? DEFAULT_TEMPLATES["file-note"];
  const path = TEMPLATE_PATHS[level];
  if (!path) return fallback;
  try {
    const t = await readFile(path);
    const body = stripTemplateFrontmatter(t);
    if (body && body.includes("{{")) return body;
  } catch {
    /* no override */
  }
  return fallback;
}
