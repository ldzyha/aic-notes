# Vendored from aic

Source: `/home/dev/aic` (private repo), branch `v1`,
commit `6d988afcd901081608e3839bc71581ef994b8475` (2026-07-03),
directory `modules/markdown/web/src/`.

This is a fork by design — aic keeps evolving and these files do not track it
automatically. To refresh: `diff -r` each file below against the aic source,
re-apply the adaptations listed here, bump the commit hash.

| File | Disposition | Adaptation |
| --- | --- | --- |
| `language.js` | verbatim | — |
| `session.js` | adapted | kept `HANDLERS` + `decorationPlugin`; dropped the `MarkdownSession` class (aic buffer-session wiring: host store, mermaid float preview, fenced service resolver) |
| `handlers/heading.js` | verbatim | — |
| `handlers/emphasis.js` | verbatim | — |
| `handlers/inline-code.js` | verbatim | — |
| `handlers/list.js` | verbatim | — |
| `handlers/link.js` | verbatim | — |
| `handlers/blocks.js` | adapted | `hrHandler` renders a real horizontal rule: `.cm-md-hr-line` line decoration + transparent dashes, raw source on reveal (owner 2026-07-06 "--- is not visible"; aic keeps colored dashes) |
| `handlers/code-fence.js` | verbatim | — |
| `handlers/frontmatter.js` | replaced | interactive property inputs, add, and drag reorder delegate all Markdown mutations to `vendor/aic-editor-core/structured-preview.js` |
| `handlers/table.js` | replaced | interactive cell/header inputs, add row/column, and drag reorder delegate all Markdown mutations to `vendor/aic-editor-core/structured-preview.js` |
| `link-actions.js` | replaced | tooltip removed; direct open/copy/edit control delegates shared DOM behavior to `vendor/aic-editor-core/structured-preview.js`, with VS Code host routing for local/external links and clipboard |
| `mermaid.js` | adapted | kept the widget path (`mermaidFences`, `MermaidWidget`, `renderInto`, `makeMermaidExtension`, lazy chunk + structured errors); stripped the visual builder profiles/console and AI explain; theme from the VS Code body class; aic's caret-follow preview (console slot) is reshaped as the in-buffer `EditingPreviewWidget` — the live diagram below a fence while its source is edited (no aic equivalent, CSS in `src/webview/theme.css`); `renderInto` keeps the upstream `context` param — "widget" = one-line error marker (detail in title), "float" = `ErrorCard` inline in the editing preview; both widgets wrap the render target in a `diagramShell` with a layout-only zoom bar (`attachZoom`, no aic equivalent; CSS in `src/webview/theme.css`) |
| `styles.js` | adapted | shared direct-link and structured-preview controls added; CSS variables (`--fg/--marker/--accent/…`) are supplied by `src/webview/theme.css` from `--vscode-*` |
| `components-stub.js` | new | minimal `Icon`/`ErrorCard` stand-in for `@aic/components` (`ErrorCard` ≈ aic's `ErrorState`, consumed by `renderInto`'s "float" context) |

NOT vendored: `render.js` (chat preview renderer), `code-highlight.js` (the
preview's static highlighter — the editor uses `@codemirror/language`
`defaultHighlightStyle` instead), `fenced.js` (host-service parser resolver —
reimplemented as `src/webview/fenced-local.js` over static lazy
`@codemirror/lang-*` imports), `detached.js` (its assembly recipe is
reimplemented in `src/webview/main.js`), `index.js`, `lazy/*` (spellcheck,
module registration), the mermaid visual builder, and aic's
`makeMermaidPreview` console-slot surface (its render-only role is covered by
`EditingPreviewWidget` in the adapted `mermaid.js` — one page, no separate
preview surface; a WebviewPanel version existed briefly in 0.3.0 and was
removed by owner direction 2026-07-06).

Also ported (outside this directory, from `modules/notes/web/src/`):
`src/notes/paths.js` (index.js:17–53 verbatim), `src/notes/frontmatter.js`
(lazy/sync.js:172–217 verbatim), `src/notes/templates.js` (lazy/sync.js:219–263
adapted — fs via `workspace.fs`, unfilled `{{token}}` lines deleted).
