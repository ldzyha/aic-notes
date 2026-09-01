# Release provenance

## AIC for Standard Notes contract

- Source repository: `https://github.com/ldzyha/standard-notes-aic`
- Paired editor contract: `9.1.0` / AIC Editor Core `2.2.0`
- Commit: `f5c9cdcf3672867e920d3d86e017576c35e79fb4`
- Authority files reviewed: `src/styles.css`, `src/editor.ts`, `src/language.ts`,
  `src/markdown-decorations.ts`, `src/block-views.ts`, `src/commands.ts`, `src/toolbar.ts`,
  `src/link-actions.ts`, `src/core/structured-preview.js`, and Mermaid modules.

AIC Notes adapts that editor's observable contract to VS Code: exact Markdown source, styled
in-place structures, task/table/frontmatter/Mermaid behavior, and its `--aic-*` visual tokens mapped
to VS Code theme tokens. Standard Notes account/runtime code is not bundled. The existing AIC Notes
Markdown implementation remains the runtime engine; the v6.6.1 adapter keeps the Secondary surface,
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
- Shared Linux/WebAssembly build toolchain: Go `1.27.0` Windows amd64 with the official
  cross-compilers (`linux/amd64` and `js/wasm`), both with `CGO_ENABLED=0`.
- Linux helper SHA-256: `4124e41b6c959c3f41a5dfc937e241ada0ea26b5c648f1952fe33eb035456f08`
- WebAssembly helper SHA-256: `2ae7496e59b439a9e8f9a0523f7ddf40ed5ccf5a93140b80aae04622d0c8680e`
- Go WebAssembly runtime SHA-256: `0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14`

The bridge is independently authored for this extension. It imports the MIT library directly and
does not import, execute, or bundle `sn-cli`. The pinned client sends the current Standard Notes
client/version headers on authentication and sync requests. The bridge accepts one bounded JSON
request on stdin and emits one bounded JSON response on stdout. Secret values and upstream response
text are not included in success/error output. AIC Notes does not call the library's operating-system
keyring persistence: the extension supplies an authenticated local vault and a wrapping key held by
VS Code SecretStorage.

The Windows artifact compiles the same bridge package to `js/wasm` with Go `1.27.0` and bundles
the matching Go `wasm_exec.js` runtime under its BSD-3-Clause license. No Standard Notes AGPL SDK
or executable wrapper is bundled. The WebAssembly module runs in the VS Code extension host and
uses the same encrypted vault protocol as the native Linux build.

## Shared editor core

- Core contract version: `2.2.0`
- VS Code snapshot: `vendor/aic-editor-core/draft-session.js`
- Standard Notes snapshot: `src/core/draft-session.js` in `ldzyha/standard-notes-aic`
- VS Code structured snapshot: `vendor/aic-editor-core/structured-preview.js`
- Standard Notes structured snapshot: `src/core/structured-preview.js`

The byte-equivalent dependency-free state machine owns hydration, dirty drafts, commit boundaries,
failed-save retention, and external-update rejection. Each product keeps only a thin host adapter:
VS Code persists through `workspace.fs`/`TextDocument`, while the component persists through the
Standard Notes extension API. The byte-equivalent structured module owns table/property mutation,
nested YAML parsing and hierarchy-preserving reorder behavior, validation, serialization,
selection-driven source disclosure, and direct open/copy/edit link-control composition.

## Existing AIC Markdown sources

See `vendor/markdown/PROVENANCE.md` for the earlier pinned AIC implementation and per-file
adaptations. The bundled JetBrains Mono files retain their OFL notice under
`src/webview/fonts/OFL.txt`.

## Release artifact identity

The GitHub release must contain the exact locally tested Linux x64 and Windows x64 VSIX files plus
their SHA-256 sidecars. Both target manifests, bundled core artifacts, and checksums are verified;
published VSIX files are redownloaded and byte-compared before the release is considered complete.
