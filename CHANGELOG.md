# Changelog

## 0.7.0 — 2026-07-06

- Diagrams render full editor width (escaping the 76ch text column) with a
  hover zoom bar (50–400%, horizontal-scroll panning).
- Notes tree: the orphan warning now appears only when a note's frontmatter
  claims a `file-note`/`folder-note` target that is gone; free-standing notes
  show a plain icon.

## 0.6.0 — 2026-07-06

- Delete from the notes tree: per-note and per-folder (with the `.aic/notes`
  bucket), modal confirmation, trash-first.

## 0.5.2 — 2026-07-06

- Fix: table cells with a link or emphasis froze the editor (shared regex
  state across the recursive cell renderer); cell rendering extracted to a
  testable module with regression coverage.

## 0.5.0 / 0.5.1 — 2026-07-06

- Dark document typography: #E5E5E5 on #121212, 16px body at 1.6 line-height,
  76ch centered measure, bundled JetBrains Mono (OFL).
- Dark syntax highlighting for fenced code (replaces the light-palette
  default); headings by size + accent, underline reserved for links.
- Table cells render inline markdown (code/links/bold/italic/strike) and get
  their own cell backgrounds; `---` draws a real horizontal rule.
- Extension icon (the aic logo).

## 0.4.0 — 2026-07-06

- One-page mermaid preview: the live diagram renders inline below the fence
  while its source is edited (the separate preview tab is gone).

## 0.3.0 — 2026-07-05

- The editor claims every `*.md` (native editor reachable via Reopen With and
  a `Use Native Editor for Plain Markdown` command).
- Full aic reveal-rule session: headings, emphasis, inline code, clickable
  task checkboxes, list continue/renumber, link tooltip, blockquote/hr/
  strikethrough, nested fenced-code highlighting (lazy chunks).

## 0.2.0 — 2026-07-03

- Minimal note editor: live table grid, frontmatter props table, in-place
  mermaid; `*.note.md` only.

## 0.1.x — 2026-07-03

- Notes tree (global/project/bucket/per-directory), quick note creation with
  level templates, explorer nesting defaults.
