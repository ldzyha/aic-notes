# Release provenance

[English](PROVENANCE.md) · [Українська](PROVENANCE.uk.md)

## Release 52.1.0 — responsive records and edit-exit ordering

AIC Editor Core 7.3.0 supplies natural-width field wrapping, lock-only password
copy and stable row sorting when leaving source edit. Main editor and Linked
Note consume the same mirrored code. `CORE_SNAPSHOT.json` records the canonical
commit and exact byte hashes. This release pairs with Standard Notes AIC 44.1.0
and experimental browser 0.9.0. The bilingual `RELEASE_INSTALL.md` is shared by
both GitHub release pages and included in the VSIX.

## Release 51.1.0 — compact mobile AIC rows

AIC Editor Core 7.2.0 is mirrored from Standard Notes AIC commit `348bade`.
It keeps bounded labels, flexible values, compact protected copy and one trailing
creation menu in the same responsive row. `CORE_SNAPSHOT.json` records the full
canonical commit and byte hashes. It pairs with Standard Notes AIC 43.1.0 and
experimental browser 0.8.0.

## Release 50.1.0 — whole-block Cut

AIC Editor Core 7.1.0 adds clipboard-first Cut for managed block previews. The
mirrored core files and VS Code adapters keep the same exact-range and stale
source checks; `CORE_SNAPSHOT.json` records their hashes. It pairs with Standard
Notes AIC 42.1.0 and experimental browser 0.7.0.

## Release 49.1.2 — linked-note unpin and bilingual documentation

AIC Editor Core remains 7.0.0 and pairs with Standard Notes AIC 41.1.2 and
experimental browser 0.6.1. The VS Code host fixes Linked Note unpin navigation;
localized product, provenance, functional-index and changelog documents are
packaged and verified.

## Release 49.1.1 — Mermaid source and live preview

AIC Editor Core 7.0.0 pairs with Standard Notes AIC 41.1.1 and experimental
browser 0.6.0. The visual builder modules are retired from the shared core.
The source and live preview use the same strict Mermaid renderer; preview
zoom remains and rotation is removed. `CORE_SNAPSHOT.json` records the exact
canonical commit and mirrored hashes.

## Release 48.0.1 — quote accents and editable fences

AIC Editor Core 6.2.2 pairs with Standard Notes AIC 40.0.1 and experimental
browser 0.5.2. The shared callout decoration distinguishes warning and error
from ordinary information quotes without using the existing `>>> … <<<`
details syntax. Shared preview CSS owns typography, backgrounds, side rules
and measured gaps. The shared code-fence preview waits for a closing fence
and for the caret to leave its delimiters. `CORE_SNAPSHOT.json` records the
canonical commit and exact mirrored hashes.

## Release 47.0.1 — Markdown spacing and thematic breaks

AIC Editor Core 6.2.1 pairs with Standard Notes AIC 39.0.1 and experimental
browser 0.5.1. The shared preview layout measures vertical spacing within
CodeMirror lines and draws a short centered thematic break. The VS Code
Markdown adapter keeps the break's line decoration when its source is
revealed, preserving height. The exact canonical commit and mirrored hashes
are recorded in `CORE_SNAPSHOT.json`.

## Release 46.1.1 — blank AIC rows and responsive fields

AIC Editor Core 6.2.0 pairs with Standard Notes AIC 38.1.1 and experimental
browser 0.5.0. The canonical core owns the blank text row, optional typed fields,
responsive label/value layout and narrow-screen password-generation visibility.
The exact canonical commit and mirrored file hashes are recorded in
`CORE_SNAPSHOT.json`; VS Code retains local document and clipboard ownership.

## Release 44.4.7 — aic-only typed values and a smaller VS Code host

AIC Editor Core 6.0.0 pairs with Standard Notes AIC 35.3.9. The explicit shared
inventory now includes the aic-only typed-pipe model, the local editor guide, and
canonical field presets. The VS Code host removes its native Notes & Documents tree
and every save-time YAML metadata writer while retaining local note files, Linked
Note, source following, contextual parents, ordinary Explorer, and exact authored text.
The shared layout retains its BEM compatibility contract.
Card/composite labels and first values now align with adjacent simple fields, while
contextual Field/Row/Section actions follow the relevant row; empty sections keep
Row/Section inline without a dedicated footer. Field-add menus use compact left-aligned items while retaining their
actions, bounds and keyboard behavior. Masking, copy, Paste, deletion and reordering
ownership remain host-scoped. Legacy YAML Properties are not interpreted or migrated.
Linked-note headers no longer project filesystem dates, and the main note footer
keeps one in-place source/preview toggle. The linked owner's navigation action remains
separate in the Secondary pane.

The canonical source remains `standard-notes-aic/src/core`; AIC Notes consumes the
explicitly inventoried mirror in `vendor/aic-editor-core`. The final canonical commit,
exact mirrored hashes and passing release gate must be recorded in
`CORE_SNAPSHOT.json` before publication. This release does not include the separately
proposed global Shared/encryption design, and no Marketplace publication is implied.

## Release 43.0.1 — additive shared UI contract and inline cards

AIC Editor Core 5.3.0 pairs with Standard Notes AIC 34.3.1. The explicit inventory
adds the shared UI component IDs, BEM helpers, declarations and geometry tokens, while
the canonical preview layout owns common shell, header and code-preview styling. The
adoption is additive and partial: compatibility selectors and host placement remain;
no universal legacy-selector removal or duplicate-free stylesheet is claimed.

The VS Code-visible fix places the optional card label, masked last four digits,
expiry and masked CVV in the shared compact inline composite row without changing
copy, Paste, deletion or reordering ownership. The canonical source remains
`standard-notes-aic/src/core`; AIC Notes consumes the explicitly inventoried mirror in
`vendor/aic-editor-core`. The final canonical commit, exact mirrored hashes and passing
release gate must be recorded in `CORE_SNAPSHOT.json` before publication. No
Marketplace publication is implied by this release target.

## Release 42.0.3 — shared editor presentation corrections

AIC Editor Core 5.2.0 pairs with Standard Notes AIC 33.2.4. Its additive `previewOnly`
API does not add a VS Code user feature. The release target fixes compact generic
pipe-field rendering and repeated parsing, viewport-bounded Add-field menus, and a
visible themed writing caret. The canonical source remains
`standard-notes-aic/src/core`; AIC Notes consumes the explicitly inventoried mirror in
`vendor/aic-editor-core`. The final canonical commit, exact mirrored hashes and passing
release gate must be recorded in `CORE_SNAPSHOT.json` before publication. No Marketplace
publication is implied by this release target.

## Release 38.4.3 — versioned Security/Properties field contract

AIC Editor Core 4.2.0 pairs with Standard Notes AIC 29.4.3. The canonical source is
`standard-notes-aic/src/core`; AIC Notes consumes its explicitly inventoried mirror in
`vendor/aic-editor-core`. This release target adds compact searchable Security/Properties
groups and menus, safe field/group/card reordering, temporary whole-editor Markdown
source mode, and opt-in v2 pipe fields. It also retires stale code-preview callbacks,
protects Mermaid visual drafts across source-mode changes, and improves coarse mobile
control layout and contrast. Host adapters keep persistence, clipboard and theme ownership;
no authentication or note-synchronization mechanism is added.

`aic-security v2` and the first-body-line frontmatter comment `# aic-fields: v2` are
explicit format gates. New Security templates and newly converted Authenticator records
use v2. Existing unversioned blocks and Properties headers are not automatically
migrated; literal pipes and marker-like labels remain legacy data. An existing header
requires deliberate marker insertion after reviewing/escaping authored values. Managed
`file`, `created` and `updated` remain read-only; raw Markdown and exports remain plaintext.

The exact canonical source commit and each mirrored file's SHA-256 must be recorded in
`CORE_SNAPSHOT.json` after the final canonical commit and snapshot regeneration. Any
current working-tree snapshot identifies working-tree bytes, not a committed release;
publication must pass the core identity and artifact gates. Historical entries below
remain unchanged.

## Release 36.4.4 — shared security lifecycle, recovery and save boundaries

Core 4.0.0 pairs with Standard Notes AIC 27.4.4. The explicit inventory adds the
recovery-code codec and shared save-boundary module, each with declarations. One renderer
owns masking, empty-field controls, optional headers and recovery-code interaction.
Host adapters retain persistence ownership: shared annotations and focus-leave intent do
not perform direct storage writes. The committed canonical revision and SHA-256 inventory
are recorded in CORE_SNAPSHOT.json; previous release records remain unchanged.

## Release 34.1.0 — shared Authenticator JSON converter

Core 3.7.0, paired with Standard Notes AIC 25.1.0, adds five explicitly inventoried
files for bounded JSON conversion and its shared contextual CodeMirror UI. All 70 core
files are byte-verified against the canonical source. Main and sidebar mount the same
extension; they do not implement separate conversion logic.

The converter makes only an explicit current-document draft edit and preserves exact
credential strings. No dependency, platform helper, clipboard read, account scan, native
note-type migration or synchronization mechanism was added. Source and UI checks cover
invalid input, stale controls, read-only state and Markdown nesting boundaries.

The committed canonical revision and complete SHA-256 inventory are recorded in
CORE_SNAPSHOT.json. Previous release records below remain unchanged.

## Release 33.0.1 — direct empty-field Paste

Core 3.6.1, paired with Standard Notes AIC 24.0.1, retains the explicit 65-file
inventory. Shared security preview now enforces empty targets at control, snapshot
and commit boundaries. Direct clipboard reads do not open an AIC panel on success;
masked input is only an access-failure fallback. No Replace or history picker is shipped.

The VS Code clipboard host additionally rejects missing/non-string request IDs before
native access. No dependency or platform helper changes. The committed canonical
revision and exact SHA-256 inventory are recorded by CORE_SNAPSHOT.json. Tests cover
both actual webview bundles and the shared editor with synthetic clipboard data.

Historical releases below remain unchanged.

## Release 32.2.1 — shared security clipboard and password generation

The explicit shared inventory now contains 65 files. Core 3.6.0, paired with
Standard Notes AIC 23.2.1, adds `security-password.js` and its declaration. Field
preview, masking, clipboard consent/cancellation, password controls and icon/CSS
assets remain canonical in `standard-notes-aic/src/core`; the VS Code adapter only
provides the native clipboard channel. No platform executable or dependency was added.

`CORE_SNAPSHOT.json` records the canonical commit, source state and each file's
SHA-256. Release verification requires a committed canonical source. The clipboard
host and webview client additionally bind requests to the initiating surface,
document path and generation, with bounded waits and fixed-category diagnostics.

Synthetic browser checks cover actual main/sidebar bundles and the Standard Notes
editor, including tap/keyboard actions, masked Paste, read cancellation, empty-field
generation, explicit saving and mobile theme/target sizes. Emulation does not establish
physical mobile clipboard permission behavior or real-account authentication.

Historical release provenance is retained below.

## Release 31.3.8 — lifecycle, shared security and context review

The current snapshot includes 63 explicitly distributed core files, selected by canonical
`standard-notes-aic/CORE_FILES.json`. New shared owners are `task-marker`, `details-model`,
`code-languages` and `render-queue` (JavaScript and declarations). Task/language/parser adapters
consume these modules; Mermaid preview and builder use the same queue. Security model, preview,
TOTP and local QR-decoder foundations are shared; QR import UI is not enabled. The shared sphere
renderer is connected to the VS Code-only workspace graph adapter. Its static import parser uses
the explicitly pinned pure-JavaScript `@lezer/javascript` dependency. No native helper was added.

Run `node scripts/sync-editor-core.mjs --snapshot` in the canonical repository to mirror bytes and
record their SHA-256 hashes. Uncommitted canonical inputs produce `sourceState: working-tree`;
the recorded HEAD is then only the base commit, not a claim that it contains the new bytes.
`--check` is read-only. The extension release verifier rejects working-tree provenance.
Publication requires the canonical commit, regenerated snapshot and both products' checks.
Core 3.5.0 is paired with Standard Notes AIC 22.1.8. The canonical source commit and exact
distributed bytes are recorded in CORE_SNAPSHOT.json rather than a manually copied revision.
This section does not change historical release provenance below.

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
