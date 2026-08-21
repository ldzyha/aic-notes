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
Markdown implementation remains the runtime engine; the v3.4.0 adapter adds the Secondary surface
and Standard Notes AIC theme/interaction contract.

## Standard Notes bridge

- Direct dependency: `github.com/jonhadfield/gosn-v2`
- Commit: `3e1eadbafef0cf76c6581ea46ee17c5a538f3528`
- Go module version: `v0.0.0-20260129121224-3e1eadbafef0`
- License: MIT; notice reproduced in `THIRD_PARTY_NOTICES.md`
- Build toolchain: Go `1.25.1` Linux amd64
- Official toolchain archive: `go1.25.1.linux-amd64.tar.gz`
- Official SHA-256: `7716a0d940a0f6ae8e1f3b3f4f36299dc53e31b16840dbd171254312c41ca12e`

The bridge is independently authored for this extension. It imports the MIT library directly and
does not import, execute, or bundle `sn-cli`. It accepts one bounded JSON request on stdin and emits
one bounded JSON response on stdout. Secret values are not included in success/error output.

## Existing AIC Markdown sources

See `vendor/markdown/PROVENANCE.md` for the earlier pinned AIC implementation and per-file
adaptations. The bundled JetBrains Mono files retain their OFL notice under
`src/webview/fonts/OFL.txt`.

## Release artifact identity

The GitHub release must contain the exact locally tested Linux x64 VSIX and a SHA-256 sidecar. The
published VSIX is redownloaded and byte-compared before the release is considered complete.
