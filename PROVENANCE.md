# Release provenance

## Release 30.0.1 — authentication response compatibility

This hotfix is based on release 29.1.0 commit `3364aade127a286cc82814873632f2841bb50f3c`.
Only the host authentication transport, account diagnostic projection and account message
formatter change at runtime. Shared editor core remains the exact 3.4.0 snapshot below;
Standard Notes plugin 21.3.5 requires no update. Unfinished parent routing and sphere work
is not part of this release.

An isolated VS Code 1.137.0 host (Node 24.18.1 / Electron 42.10.0) reproduced the old
leading-BOM and folded-cookie rejection against a loopback synthetic server. The patched
transport passed both cases and a combined case with VS Code's Electron fetch enabled.
No real account, credentials, notes or remote sync endpoints were used in those probes.
Unit tests cover bounded parsing, cookie-pair validation, HTTP/challenge precedence,
account-state propagation and allowlisted diagnostics with secret canaries.

This is verification of specific compatibility fixes, not a claim that a user's observed
login failure has been reproduced with their account. A user-entered native sign-in remains
the acceptance check; if it fails, the UI reports a fixed stage/reason without response data.

## Release 29.1.0 — host-only authentication

Editor core remains the exact 3.4.0 snapshot below. No sphere module or sync runtime is enabled.
`src/auth` owns host UI, bounded auth transport and SecretStorage lifecycle; the Standard Notes
editor plugin does not duplicate this host adapter. Account sign-in never enters the editor bus.

The protocol implementation was checked against primary upstream sources, not an unofficial SDK:

- Standard Notes app commit `6fcb991e626b0388a2220fa0d94815bf6c0c9f8d`:
  `packages/snjs/specification.md`, `lib/Services/Api/ApiService.ts`,
  `lib/Services/Session/SessionManager.ts` (the latter paths under `packages/snjs`),
  and `packages/snjs/mocha/004.test.js` for the production-cost root-key vector.
- Standard Notes server commit `6a43c34eff09780cb556f8fea06bb97ddcb42002`:
  auth `SessionService`, `GetSessionFromToken`, `CookieFactory`, `BaseAuthController`
  and `BaseSessionController`. API 20200115 requests legacy bearer sessions; cookie-v2
  selectors are accepted only with a validated access/refresh cookie pair.
- The JavaScript Argon2id implementation is pinned to MIT-licensed `@noble/hashes` 2.4.0
  in package-lock.json. Its complete license is in THIRD_PARTY_NOTICES.md.
- Cooperative auth-operation exclusion uses `proper-lockfile` 4.1.2 with a 60-second stale
  threshold and 10-second heartbeat, on VS Code extension global storage. It stores no keys
  or tokens on disk. All auth mutations re-read SecretStorage under this lease; busy windows
  fail explicitly. This does not implement cross-device editing locks.

Network requests are limited to login parameters, login, session listing/check, refresh and logout.
Tests mock these routes except the local official-vector KDF. A real account smoke test has not
been substituted by these mocks. No credentials or user note contents are release fixtures.

## Release 28.4.5 — canonical shared core

The canonical editor sources are `../standard-notes-aic/src/core`; all JavaScript,
CSS and declaration files are mirrored mechanically into `vendor/aic-editor-core`.
From that repository, `npm run core:sync` updates the mirror and `npm run core:check`
checks every file and rejects extra vendor modules. Do not implement a second copy.
The source commit below contains this release's canonical core. `CORE_SNAPSHOT.json`
records every shared file and its SHA-256; `npm run core:check` validates the complete
vendored inventory on any checkout without requiring a sibling repository.

New shared modules are `diagram-model.{js,d.ts}`, `diagram-builder.{js,css,d.ts}`,
`diagram-session.{js,css,d.ts}`, `diagram-palette.{js,css,d.ts}`,
`mermaid-runtime.{js,d.ts}`, `diagram-renderer.{js,d.ts}`,
`indentation.{js,d.ts}`, `formatting.{js,d.ts}`, `agentic-notes.{js,d.ts}`,
`note-template.{js,d.ts}` and `preview-layout.css`.
They own the bounded Mermaid model, visual UI, source-bound inline lifecycle, new-note
prompts and CodeMirror-compatible widget spacing. Both Mermaid adapters invoke the
same inline session and Mermaid runtime. The former custom-coordinate canvas/router is retired.
The builder is experimental; source fallback and supported-grammar limitations
are documented in README. No Standard Notes synchronization runtime is added to VS Code.
Agentic Notes primitives are not connected to a standalone writer. Their policy reader uses
the pinned ISC-licensed `yaml` 2.9.0 parser in both source workspaces; no platform helper is added.

## AIC for Standard Notes contract

- Source repository: `https://github.com/ldzyha/standard-notes-aic`
- Paired editor contract: AIC for Standard Notes `21.3.5` / AIC Editor Core `3.4.0`
- Authority source commit: `cde15f590d1c85ed4b770799aa455fee7d6b9480`
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

- Core contract version: `3.4.0`
- Complete immutable source/file manifest: [CORE_SNAPSHOT.json](CORE_SNAPSHOT.json)
- Canonical source: `src/core` at commit `cde15f590d1c85ed4b770799aa455fee7d6b9480`
- Distributed copy: `vendor/aic-editor-core` (43 byte-identical files)
- Release gate: `npm run core:check` checks source identity, version, exact inventory and every hash.
- Git attributes preserve LF for shared files on Windows and Linux; no hand-maintained partial hash list.

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
activation boundary, contextual ordering, question placeholders, immediate CodeMirror activation,
and compact host-token completion presentation. Both products mount its CodeMirror adapter; AIC
Notes additionally exposes the same catalog through a thin VS Code completion adapter when a plain
or untitled Markdown document uses the native editor.

## Existing AIC Markdown sources

See `vendor/markdown/PROVENANCE.md` for the earlier pinned AIC implementation and per-file
adaptations. The bundled JetBrains Mono files retain their OFL notice under
`src/webview/fonts/OFL.txt`.

## Release artifact identity

The tag pipeline builds one universal VSIX plus its SHA-256 sidecar from the committed source.
The downloaded CI artifact is verified separately against its checksum and local production
output; archive bytes may differ from local packaging because ZIP metadata differs. Do not call
those archives byte-identical without checking them. The release gate rejects platform-targeted
manifests, native/WASM helpers, development sources, retired synchronization commands/settings,
missing core artifacts, a stale core snapshot or a mismatched checksum.
