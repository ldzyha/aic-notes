# Release provenance

## AIC for Standard Notes contract

- Source repository: `https://github.com/ldzyha/standard-notes-aic`
- Version: `v0.1.1`
- Commit: `010501fe03a0f06b114e0414caf556fee05c3418`
- Authority files reviewed: `src/styles.css`, `src/editor.ts`, `src/language.ts`,
  `src/markdown-decorations.ts`, `src/block-views.ts`, `src/commands.ts`, `src/toolbar.ts`,
  `src/link-tooltip.ts`, and Mermaid modules.

AIC Notes adapts that editor's observable contract to VS Code: exact Markdown source, styled
in-place structures, task/table/frontmatter/Mermaid behavior, and its `--aic-*` visual tokens mapped
to VS Code theme tokens. Standard Notes account/runtime code is not bundled. The existing AIC Notes
Markdown implementation remains the runtime engine; the v5.3.1 adapter keeps the Secondary surface,
adds the exact AIC details markers, and preserves the Standard Notes AIC theme/interaction contract.

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

## Standard Notes bridge

- Direct dependency: `github.com/jonhadfield/gosn-v2`
- Commit: `28e3820a341fad50b42f0ed29adb690077e87b46`
- Go module version: `v0.0.0-20260523114812-28e3820a341f`
- License: MIT; notice reproduced in `THIRD_PARTY_NOTICES.md`
- Build toolchain: Go `1.25.1` Linux amd64
- Official toolchain archive: `go1.25.1.linux-amd64.tar.gz`
- Official SHA-256: `7716a0d940a0f6ae8e1f3b3f4f36299dc53e31b16840dbd171254312c41ca12e`

The bridge is independently authored for this extension. It imports the MIT library directly and
does not import, execute, or bundle `sn-cli`. The pinned client sends the current Standard Notes
client/version headers on authentication and sync requests. The bridge accepts one bounded JSON
request on stdin and emits one bounded JSON response on stdout. Secret values and upstream response
text are not included in success/error output. AIC Notes does not call the library's operating-system
keyring persistence: the extension supplies an authenticated local vault and a wrapping key held by
VS Code SecretStorage.

## Existing AIC Markdown sources

See `vendor/markdown/PROVENANCE.md` for the earlier pinned AIC implementation and per-file
adaptations. The bundled JetBrains Mono files retain their OFL notice under
`src/webview/fonts/OFL.txt`.

## Release artifact identity

The GitHub release must contain the exact locally tested Linux x64 VSIX and a SHA-256 sidecar. The
published VSIX is redownloaded and byte-compared before the release is considered complete.
