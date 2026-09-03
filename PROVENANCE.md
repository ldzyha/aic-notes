# Release provenance

## AIC for Standard Notes contract

- Source repository: `https://github.com/ldzyha/standard-notes-aic`
- Paired editor contract: `20.1.1` / AIC Editor Core `3.3.0`
- Commit: `809493d41e5d8bc1735dee34c0990e9cc71a1e69`
- Authority files reviewed: `src/styles.css`, `src/editor.ts`, `src/language.ts`,
  `src/markdown-decorations.ts`, `src/block-views.ts`, `src/commands.ts`, `src/toolbar.ts`,
  `src/link-actions.ts`, `src/core/structured-preview.js`, `src/core/code-fence-preview.js`,
  `src/core/code-fence-extension.js`, `src/core/icons.css`,
  `src/core/file-properties.js`, `src/core/slash-snippets.js`, `src/core/slash-snippets.css`,
  `src/core/slash-snippets.d.ts`, `src/core/mermaid-viewport.js`,
  `src/core/mermaid-viewport.css`, and Mermaid adapter modules.

AIC Notes adapts that editor's observable contract to VS Code: exact Markdown source, styled
in-place structures, task/table/frontmatter/Mermaid behavior, and its `--aic-*` visual tokens mapped
to VS Code theme tokens. Standard Notes account/runtime code is not bundled. The AIC Notes Markdown
implementation remains the runtime engine; its thin adapter keeps the Secondary surface, exact AIC
details markers, and the Standard Notes AIC theme/interaction contract.

## AIC selection-note contract

- Source repository: `https://github.com/ldzyha/aic`
- Reviewed repository commit: `acfdb0542fe01de62557513f9a3eab8d3dfedf4c`
- Selection implementation: `aic-kernel/web-v2/src/selection-notes.js`
- Selection implementation SHA-256:
  `823a68ceb62c647080a1b416ee8cbcc2b4c4925820c6724188a5f75b37e83e92`
- Contract tests: `aic-kernel/web-v2/test/selection-notes.test.mjs`
- Contract test SHA-256:
  `a0be6cd0ad4e579a24f90f0fb936a8a43f2cfa6542f3f62dd169a887b1a46388`
- Repository module contract SHA-256:
  `2df4f4603ecee687e76c2777630441da3233407aea35305e92c1655f97cf9be7`

The VS Code command independently adapts AIC's observable selection-note rule: one compact linked
details block in a canonical note section, the copied source fragment, an annotation caret in its
comment, deduplication, exact source navigation, and fail-closed `*.ai.md` owner verification. It
does not modify source bytes.

## Shared editor core

- Core contract version: `3.3.0`
- VS Code snapshot: `vendor/aic-editor-core/draft-session.js`
- Standard Notes snapshot: `src/core/draft-session.js` in `ldzyha/standard-notes-aic`
- Draft-session snapshot SHA-256: `2b9a02ead705469b9f85be59662ab124ca2452fa8bdd78c4e8c9615d4e1ad6e4`
- VS Code structured snapshot: `vendor/aic-editor-core/structured-preview.js`
- Standard Notes structured snapshot: `src/core/structured-preview.js`
- Structured snapshot SHA-256: `cd7b6df78f922bc8bc94a1b3a6964b9a42828eb07aef1c779287213844227605`
- VS Code code-fence preview snapshot: `vendor/aic-editor-core/code-fence-preview.js`
- Standard Notes code-fence preview snapshot: `src/core/code-fence-preview.js`
- Code-fence preview snapshot SHA-256:
  `a89b54ec8092d7edbe9bdad2655c63592502ed3f6c60e6a3737640f7533d5586`
- VS Code code-fence extension snapshot: `vendor/aic-editor-core/code-fence-extension.js`
- Standard Notes code-fence extension snapshot: `src/core/code-fence-extension.js`
- Code-fence extension snapshot SHA-256:
  `6d17060a43fdc71e74fa8c458abd8a80eacce9d32c6d81619ca215e4580def00`
- VS Code icon snapshot: `vendor/aic-editor-core/icons.css`
- Standard Notes icon snapshot: `src/core/icons.css`
- Icon snapshot SHA-256: `ac08a5c524f84edd975f44bceda7e86b2c5e2a1a6db7e383690fc11340ab862a`
- VS Code Mermaid viewport snapshot: `vendor/aic-editor-core/mermaid-viewport.js`
- Standard Notes Mermaid viewport snapshot: `src/core/mermaid-viewport.js`
- Mermaid viewport snapshot SHA-256:
  `05e4c7e6e0fcef298aba490fe6f49ed9c6bdc774f5423ecf4d3182455b5ad006`
- VS Code Mermaid viewport CSS: `vendor/aic-editor-core/mermaid-viewport.css`
- Standard Notes Mermaid viewport CSS: `src/core/mermaid-viewport.css`
- Mermaid viewport CSS SHA-256:
  `460442d21f918f6b9ff82ea40fd5ecf28dcde36f5dd5f36dd60dc811d6487e20`
- VS Code Mermaid viewport declarations: `vendor/aic-editor-core/mermaid-viewport.d.ts`
- Standard Notes Mermaid viewport declarations: `src/core/mermaid-viewport.d.ts`
- Mermaid viewport declaration SHA-256:
  `bd886ed5204363312c176275429b746da05e31d1106869acf9565ac412b25ebe`
- VS Code file-properties snapshot: `vendor/aic-editor-core/file-properties.js`
- Standard Notes file-properties snapshot: `src/core/file-properties.js`
- File-properties snapshot SHA-256: `2692d4ed30ee5f09b30cc3275fe8b88385be26c39400bb44574e43cccc5391bd`
- VS Code slash-snippet snapshot: `vendor/aic-editor-core/slash-snippets.js`
- Standard Notes slash-snippet snapshot: `src/core/slash-snippets.js`
- Slash-snippet snapshot SHA-256:
  `6ab248efa0ef47d902affbfae827373640dff114a48c3c69b3bcec2fab82f7df`
- VS Code slash-snippet CSS: `vendor/aic-editor-core/slash-snippets.css`
- Standard Notes slash-snippet CSS: `src/core/slash-snippets.css`
- Slash-snippet CSS SHA-256:
  `c091f1ec73f9e508ba104efe6d3c3fc3dde239e072e479ccdb7d06389b505058`
- VS Code slash-snippet declarations: `vendor/aic-editor-core/slash-snippets.d.ts`
- Standard Notes slash-snippet declarations: `src/core/slash-snippets.d.ts`
- Slash-snippet declaration SHA-256:
  `c45aba10060a341b1561b59a1a8141b7af4d10c84d1fe342227386d09dd37603`

The byte-equivalent dependency-free state machine owns hydration, dirty drafts, commit boundaries,
failed-save retention, and external-update rejection. Each product keeps only a thin host adapter:
VS Code persists through `workspace.fs`/`TextDocument`, while the component persists through the
Standard Notes extension API. The byte-equivalent structured module owns table/property mutation,
nested YAML parsing and hierarchy-preserving reorder behavior, validation, serialization,
stable native preview selection, explicit/keyboard source disclosure, direct open/copy/edit
link-control composition, icon-only
action semantics, accessible feedback state, and restricted-client clipboard fallback. The shared
code-fence preview composes those controls into a text-safe, source-bound card with exact-body Copy
and explicit Edit/source-reveal actions. The byte-equivalent CodeMirror extension owns fence
discovery, Mermaid exclusion, preview replacement, selection, read-only state, viewport refresh,
and copy routing; only the host callback differs. The shared Mermaid viewport owns zoom, focusable
two-dimensional scrolling, 90° rotation, real transformed layout bounds, and accessible icon
controls without a renderer-specific dependency. The CSS
snapshot paints embedded SVG data URIs as masks without requiring inline SVG in action-button DOM.
The file-properties module owns `*.note.md` filename/creation/update stamping at the explicit save
boundary, preserves all authored note frontmatter, removes only the exact legacy managed signature
from ordinary Markdown, and migrates only the complete legacy seven-field sidecar signature.
The shared slash-snippet module owns the seven-group page/section/block catalog, Markdown-line
activation boundary, contextual ordering, question placeholders, and host-token completion
presentation. Each product only mounts that same extension into its host editor; AIC Notes mounts
it from the one webview entry used by both plain Markdown and contextual notes.

## Existing AIC Markdown sources

See `vendor/markdown/PROVENANCE.md` for the earlier pinned AIC implementation and per-file
adaptations. The bundled JetBrains Mono files retain their OFL notice under
`src/webview/fonts/OFL.txt`.

## Release artifact identity

The GitHub release must contain one exact locally tested universal VSIX plus its SHA-256 sidecar.
The release gate rejects platform-targeted manifests, native/WASM helpers, development sources,
retired synchronization commands/settings, missing core artifacts, or a mismatched checksum.
