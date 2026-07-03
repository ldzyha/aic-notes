# aic-notes

Sidecar notes + aic-style markdown editing for VS Code. Standalone — no aic
kernel/server required; everything works off the workspace filesystem.

Two things, carried over from the [aic](https://github.com/ldzyha) editor:

1. **The `*.note.md` notes system** — one note per file/folder/project, living
   next to what it annotates:
   - file note: `src/app.js` → `src/app.note.md` (final extension replaced;
     dotfiles/extension-less append: `.env` → `.env.note.md`)
   - folder note: `src/` → `src.note.md` (sibling, never inside)
   - project note: `<rootName>.note.md` at the workspace root
   - project globals: `.aic/notes/*.note.md`
   - global note: `~/.config/aic/note.md` (cross-project)
   Every note opens with a YAML props header (`title/level/scope/status/
   updated/created/agent`). Notes are byte-compatible with aic.
2. **The markdown editor** — the default editor for every `*.md` file
   (notes included), replicating aic's markdown session: in-place reveal-rule
   styling (headings, bold/italic/strikethrough, inline code, blockquote/hr),
   clickable task checkboxes, list continue/renumber, links with an
   open/edit/unlink tooltip, nested fenced-code highlighting (lazy chunks),
   plus the three block widgets — the live table grid, the frontmatter props
   table, and mermaid diagrams rendered in place. Cursor inside a rendered
   block reveals its raw source for editing; arrow keys enter blocks. Colors
   ride the active VS Code theme. A live mermaid preview panel follows the
   caret into ```mermaid fences and can float to its own OS window.

   Escape hatches: per file, right-click the tab → **Reopen Editor With… →
   Text Editor**; globally, run **AIC Notes: Use Native Editor for Plain
   Markdown** (writes `workbench.editorAssociations` `"*.md": "default"` to
   user settings, keeping `*.note.md` on the AIC editor). Note the built-in
   markdown preview/lint features don't operate inside a custom editor.

## Usage

- **Notes view** — the Notes icon in the activity bar: pinned global note →
  project note → `.aic/notes` bucket → per-directory notes, each labeled by
  its target with a level badge; `agent: false`/`private: true` notes get a
  lock icon, notes whose target is gone get a warning.
- **`ctrl+alt+m`** — create/open the note for the current file (opens
  beside). On a note it jumps back to the target. Also on the editor title
  bar and the explorer context menu (files AND folders — folders get
  `<dir>.note.md`).
- **Explorer nesting** — notes nest under their target file in the regular
  explorer (shipped as `explorer.fileNesting.patterns` defaults). If you have
  your own `patterns` override it shadows ours wholesale — run
  **AIC Notes: Enable Explorer Nesting for Notes** to merge. Folder notes
  cannot nest (VS Code nesting is file-to-file); the Notes view covers them.
- **Templates** — fresh notes use the built-in level templates; a project can
  override them in `.aic/templates/{file-note,folder-note,project-note}.md`
  (must contain at least one `{{token}}`).
- **Markdown editor** — default for all `*.md`. Escape hatch per file:
  right-click the tab → **Reopen Editor With… → Text Editor**; globally:
  **AIC Notes: Use Native Editor for Plain Markdown**. Inside the editor:
  `ctrl+f` is the CM search panel (the VS Code find widget can't reach
  webviews); undo/redo route through VS Code's document stack.

## Build & install

```sh
npm install
npm run build        # dist/extension.js + dist/webview/* (lazy chunks)
npm test             # node:test unit tests (paths/frontmatter/templates)
npm run package      # aic-notes-<version>.vsix
code --install-extension aic-notes-*.vsix
```

Development: open this folder in VS Code, F5 ("Run Extension") — the
extension host opens `test-fixtures/`, a workspace exercising every feature.

## Verification checklist

- **Tree**: global note pinned (dimmed if absent) → project note
  (`test-fixtures.note.md`) → "project globals" bucket → `src/` notes with
  `file-note` badges; `secret.note.md` shows a lock; `deleted-target.note.md`
  shows a warning + `orphan`.
- **Create**: `ctrl+alt+m` on `src/app.js` opens the existing note;
  on `src/util.test.ts` creates `src/util.test.note.md` beside, with the
  fixture template override body and an aic-identical frontmatter header.
  Delete a note file externally → the tree refreshes.
- **Nesting**: in the explorer `app.note.md` nests under `app.js`,
  `.env.note.md` under `.env`.
- **Editor** (open `kitchen-sink.note.md`): frontmatter renders as a props
  table (click → raw YAML); markers around `**bold**` brighten when the
  cursor touches them, with zero glyph shift; the table renders as a grid
  (cursor inside → raw pipes); checkboxes toggle on click and persist;
  Enter inside a list continues it (ordered lists renumber); the `js` fence
  gets syntax colors after its chunk loads; the mermaid fence renders an SVG
  in place (click the diagram → edit the source; a broken diagram shows a
  warning marker whose tooltip carries the parse error).
- **Sync**: type in the editor → tab dirties → `ctrl+s` saves; run
  `git checkout -- <note>` while it is open → content updates without an
  echo loop; `ctrl+z` inside the editor undoes through VS Code's stack.
- **Package**: `npm run package` → install the `.vsix` → repeat the tree
  smoke test in a real window.

## Design notes

- Vendored aic sources (reveal-rule engine, handlers, mermaid widget path)
  live in `vendor/markdown/` with per-file provenance in
  `vendor/markdown/PROVENANCE.md` (pinned aic commit; fork by design).
- Document sync: the webview applies its edits locally and posts them FIFO;
  any non-echo document change (undo, git, split editor) bumps a generation
  counter and is broadcast; a webview edit with a stale generation is
  discarded and answered with a full reset. Offsets are UTF-16 code units on
  both sides.
- Failures follow aic's errors-not-fallbacks rule: structured
  `{error, detail, fix}` surfaced as VS Code notifications, never silent
  degradation.
- CSP: scripts are nonce'd + resource-origin (lazy chunks); `style-src`
  carries `'unsafe-inline'` because CodeMirror and mermaid inject styles at
  runtime (documented exception).
- `retainContextWhenHidden` keeps one webview per open note alive across tab
  switches — revisit (serialize-on-hide) if many open notes bite on memory.
