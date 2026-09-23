# Changelog

[English](CHANGELOG.md) · [Українська](CHANGELOG.uk.md)

## Unreleased

### Feature

- Made dense AIC credential rows readable on mobile and narrow sidebars. Labels
  use only their bounded text width, protected values use a compact
  lock-and-six-dot copy target, flexible values share the remaining width, and
  one trailing `+` menu owns Field/Row/Section creation. Subtle lines separate
  records without alternating background noise. Shared editor core moves to
  7.2.0.

## 50.1.0 — 2026-09-23

Release sequence 50 · 1 feature outcome · 0 fixed-bug outcomes. This release
pairs with Standard Notes AIC 42.1.0, experimental browser 0.7.0 and shared
editor core 7.1.0.

### Feature

- Added the shared **Cut** scissors action to table, code-fence, Mermaid,
  AIC/Properties and details previews. It copies the complete Markdown block
  before removing the exact source range as one editor operation. A failed or
  stale clipboard request leaves the document unchanged; read-only previews do
  not expose Cut.

## 49.1.2 — 2026-09-23

This patch pairs with Standard Notes AIC 41.1.2, experimental browser 0.6.1 and
shared editor core 7.0.0.

### Fix

- Unpinning the Linked Note now immediately resumes following the active main
  file as one navigation operation, without requiring a window reload.

### Documentation

- Added Ukrainian README, functional index, release provenance, vendored
  Markdown provenance and changelog documents with direct language links.
- Included the localized documents in the verified universal VSIX contract.

## 49.1.1 — 2026-09-22

Release sequence 49 · 1 feature outcome · 1 fixed-bug outcome. Shared editor
core 7.0.0 is mirrored from Standard Notes AIC 41.1.1; experimental browser
0.6.0 uses the same Mermaid behavior.

### Feature

1. Mermaid uses direct Markdown source editing with a live preview. The preview
   has Copy, one consistent Edit icon and zoom. The visual builder,
   drag-and-drop and rotation controls are removed.

### Fix

1. Flowchart editing no longer relies on Mermaid's internal SVG node and edge
   identifiers; the live preview keeps its current diagram visible while the
   next render completes.

## 48.0.1 — 2026-09-22

Release sequence 48 · 0 feature outcomes · 1 fixed-bug outcome. Shared editor
core 6.2.2 is mirrored from Standard Notes AIC 40.0.1; experimental browser
0.5.2 uses the same quote styling and fence behavior.

### Fix

1. Information (`>`), warning (`!>`) and error (`!>>`) quotes have distinct
   soft backgrounds and side accents, smaller text, and larger gaps between
   adjacent blocks. Italic text is smaller. `>>> … <<<` remains the details
   syntax. An unfinished code fence stays editable; a complete one does not
   preview while the caret is on either delimiter.

## 47.0.1 — 2026-09-22

Release sequence 47 · 0 feature outcomes · 1 fixed-bug outcome. Shared editor
core 6.2.1 is mirrored from Standard Notes AIC 39.0.1; experimental browser
0.5.1 uses the same layout.

### Fix

1. Both editor surfaces separate Markdown headings, quotes and lists. Thematic
   breaks appear as centered 50–100 px lines with vertical space. Revealing
   the raw `---` under the caret keeps the line height and Markdown unchanged.

## 46.1.1 — 2026-09-22

Release sequence 46 · 1 feature outcome · 1 fixed-bug outcome. AIC Editor Core
6.2.0 is mirrored byte-for-byte from Standard Notes AIC 38.1.1.

### Feature

1. New AIC blocks start with an unlabeled text row for an email or username.
   The Account row preset is removed; Password and TOTP remain separate optional
   fields. Existing authored notes are not rewritten.

### Fix

1. Narrow Linked Note and main-editor panels keep each field label with its
   value parts as the row wraps into readable columns. Password generation
   controls are hidden at viewport widths of 600 px or less. Saved secrets and
   independent copy actions remain available.

Compatibility: Standard Notes AIC 38.1.1 and experimental browser 0.5.0 use
the same shared core. No account connection or synchronization is added.

## 45.1.0 — 2026-09-15

Release sequence 45 · 1 feature outcome · 0 fixed-bug outcomes. Shared editor core
moves to 6.1.0 with an additive section-copy action. Release source target; VSIX
publication and packaged-runtime acceptance require separate verification.

### Feature

1. Copy section is available in AIC section headers in both the main editor and
   Linked Note. It copies a standalone fenced `aic` block containing only that
   section, including masked and filter-hidden rows, without the card title or
   sibling sections. The shared serializer preserves logical labels, value text
   and typed parts while normalizing source whitespace/quoting. It uses the
   existing clipboard owner and feedback, works read-only, guards stale widgets
   and never mutates or saves the source.

Compatibility: Standard Notes AIC 37.2.0 and browser 0.4.0 consume shared core 6.1.0.
The browser's new Global Shared record belongs to its own encrypted profile vault;
VS Code receives no global record, generated-key exchange or `global.aic`
encryption implementation. Local-only editing remains unchanged, with no account
connection or synchronization. No Standard Notes PWA crash fix is claimed.

## 44.4.7 — 2026-09-15

Release sequence 44 · 4 feature outcomes · 7 fixed-bug outcomes. Release source
target; VSIX publication requires separate verification. The shared editor core
moves to 6.0.0 with one breaking AIC field grammar.

### Features

1. The extension-specific Notes & Documents activity-bar tree is retired. Linked
   Note, source following, contextual parent links and ordinary Explorer remain;
   existing note files are not migrated or deleted.
2. One complete fenced `aic` document replaces active colon-field and YAML
   Properties interpretation. Old text remains raw and directly editable, and no
   save path stamps or migrates it.
3. Both VS Code editor surfaces mount the canonical local `?` guide through their
   existing compact action areas and host-owned popover lifecycle.
4. `|`, `*|`, `#|`, `_|`, `1|`, and `0|` independently type following values as
   text, secret, TOTP, card, unused one-time or used one-time data. Field/Row/Section
   insertion is relative to the current row or section; presets combine these types.

### Fixes

1. Shared AIC card rows align their label and first value with
   adjacent simple fields, including the same label typography and spacing. Cards
   omit the extra label colon; masking and independent copy targets are unchanged.
2. Contextual **Field**, **Row**, and **Section** actions follow the relevant row;
   empty sections keep **Row** and **Section** inline without a dedicated New-block
   or Section footer.
3. Shared field-add menus use compact, left-aligned options instead of oversized
   centered rows, while retaining their actions, bounds and keyboard behavior.
4. The shared card filter stays in the card header between title and actions instead
   of consuming a separate oversized row.
5. Capacity feedback stays with the relevant Add action and uses bounded fixed text.
6. Linked-note headers no longer repeat created/updated timestamps. Filesystem
   metadata remains available to VS Code for operational checks but is not projected
   into the compact note UI.
7. Main note footers expose one in-place **Show Markdown source / Show preview**
   action instead of a second source-looking button. Linked Note keeps its distinct
   owner-navigation action.

Compatibility: Standard Notes AIC 35.3.9 mirrors shared core 6.0.0. Browser 0.3.0
receives the same grammar and shared presentation fixes. Unsupported text stays raw and VS Code's
local-only boundary are unchanged. This release does not include the separately
proposed global Shared/encryption work. Published VSIX and store availability
require separate verification.

## 43.0.1 — 2026-09-15

Release sequence 43 · 0 feature outcomes · 1 fixed-bug outcome. Release source target;
VSIX publication requires separate verification. The shared editor core moves to
5.3.0 with additive UI component exports; no new VS Code user feature is counted.

### Fix

1. Card fields share the compact inline Properties/Security row: optional label,
   masked last four digits, expiry and masked CVV, with independent copy targets and
   unchanged empty-field actions.

Compatibility: Standard Notes AIC 34.3.1 mirrors shared core 5.3.0. The additive
component/BEM contract is only partially adopted and keeps compatibility selectors;
it does not change VS Code's local-only boundary or claim universal selector removal.
The separate browser extension remains experimental at 0.2.0. Published VSIX and
store availability require separate verification.

## 42.0.3 — 2026-09-14

Release sequence 42 · 0 feature outcomes · 3 fixed-bug outcomes. Release source target;
VSIX publication requires separate verification. The shared editor core moves to 5.2.0
with an additive `previewOnly` API; no new VS Code user feature is counted.

### Fixes

1. Generic pipe-style Security and Properties fields use a compact single-row preview, while shared parsing avoids repeated work across fields. Independent copying, masking and authored Markdown remain unchanged.
2. Add-field menus stay within the visible editor viewport and scroll internally when space is limited, so actions remain reachable in short or narrow panes.
3. The CodeMirror writing caret stays visible at a consistent 2 px width and follows the active text color in light and dark themes, including source mode and focus changes; reduced-motion preferences still disable blinking.

Compatibility: Standard Notes AIC 33.2.4 mirrors shared core 5.2.0. The separate browser extension remains experimental at 0.1.4; it does not add account connectivity or note synchronization to AIC Notes. Masking remains visual, not Markdown encryption. Published VSIX and store availability require separate verification.

## 41.1.1 — 2026-09-14

Release sequence 41 · 1 feature outcome · 1 fixed-bug outcome. Release source target;
VSIX publication requires separate verification. The shared editor core moves to 5.1.0.

### Feature

1. All three Security value slots, and custom Properties slots behind `# aic-fields: v2`, accept optional JSON-style double-quoted strings. Quoted pipes (including `|`), quotes, backslashes and control escapes retain their logical values. Serialization quotes values containing a pipe or quote, including pasted and imported values; ordinary values need no quotes. YAML outer quoting remains separate: `Password*: '"a | b" | "description"'` preserves the inner field-slot double quotes. Labels and titles have no quote syntax.

### Fix

1. Only the exact spaced `|` outside quotes separates slots. Bare or one-sided pipes remain literal data, while existing `\|` outside quotes still parses. Invalid quotes, escapes or trailing text receive generic, non-secret errors; Security errors identify exact source positions.

Compatibility: Standard Notes AIC 32.1.1 mirrors shared core 5.1.0. Existing authored values are not automatically rewritten. No Standard Notes authentication or note synchronization is added; masking remains visual, not encryption. Publication requires separate verification.

## 40.6.6 — 2026-09-13

Release sequence 40 · 6 feature outcomes · 6 fixed-bug outcomes. Release source target;
VSIX publication requires separate verification. The shared editor core moves to 5.0.0
because the Security fence grammar changes to one format.

### Features

1. One unversioned `aic` fence replaces the versioned Security fence variants for new content. Security sections use the single grammar with optional labels; authored legacy blocks require review when moving to the new format rather than an assumed automatic migration.
2. Compact payment-card rows show only the last four number digits, expiry and masked CVV while preserving independent copying and source Edit.
3. Security fields can be dragged across sections as well as reordered within a section; moves retain exact authored source outside the changed fields.
4. Properties presents managed metadata, the related-note tree and custom fields in the compact shared Security surface, while managed values and navigation stay read-only.
5. Labelled Add controls expose capacity and explain why an action is disabled at a limit instead of leaving an unexplained inactive control.
6. The VS Code extension removes the Standard Notes sign-in and transport runtime, leaving a local-only Markdown editor without account connectivity or note synchronization.

### Fixes

1. Escape handling is consistent across source, preview and Mermaid fence boundaries.
2. Target feedback is transient and guarded against stale document or widget state.
3. Field labels and values copy independently, without substituting one for the other.
4. Filtering does not expose a masked card number (PAN).
5. Label and drag controls remain legible and usable across narrow layouts and dark/light themes.
6. Preview filtering and rendering avoid repeated work for unchanged content.

Compatibility: Standard Notes AIC 31.5.6 mirrors shared core 5.0.0 in the universal VSIX. The Security fence grammar changes; the extension no longer provides Standard Notes authentication or transport, and note synchronization remains absent. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 39.3.3 — 2026-09-13

Release sequence 39 · 3 feature outcomes · 3 fixed-bug outcomes. Release source target;
VSIX publication requires separate verification.

### Features

1. `aic-security v3` adds standalone `---` section boundaries and optional `##` headings. New templates use v3; existing unversioned/v2 blocks retain their grammar and are not migrated.
2. Authenticator JSON conversion preserves ordered records and exact string values in grouped v3 blocks, spilling at canonical capacity and splitting oversized accounts only at field boundaries. Invalid input still rejects atomically without partial conversion.
3. Security previews show section, field and text capacity. Add controls that would exceed a limit are disabled, while New block remains available; conversion guidance suggests separate blocks by purpose, such as services, banks, web and social networks.

### Fixes

1. Security and Properties errors provide safe, precise source line/column diagnostics and Edit navigation without exposing credentials or raw parser messages.
2. New block closes an EOF-terminated previous fence before inserting an independent Security block.
3. Whole-card reordering preserves exact authored source and supports versioned v2/v3 fences without rewriting fields or unrelated Markdown.

Compatibility: Standard Notes AIC 30.3.3 mirrors shared core 4.3.0 in the universal VSIX. No authentication or note-synchronization change. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 38.4.3 — 2026-09-13

Release sequence 38 · 4 feature outcomes · 3 fixed-bug outcomes. Release source target;
VSIX publication requires separate verification.

### Features

1. Compact, searchable Security and Properties groups provide group menus, one **+** disclosure and independent `#` Security card titles. Search matches names and visible values, never hidden values, recovery codes or generated one-time codes.
2. Safe drag/drop and Alt+Up/Down handles reorder Security fields, sections and standalone cards, and supported sibling Properties fields/groups. Filtered lists, managed metadata, sequence items and unsupported layouts cannot be reordered; host-managed saves remain undoable.
3. A temporary whole-AIC-editor **Show Markdown source / Show preview** toggle exposes the current note's raw Markdown without opening the native editor, persisting mode, changing source, saving or resetting Undo.
4. Opt-in versioned pipe fields use `aic-security v2` and the first-body-line Properties YAML comment `# aic-fields: v2`. `*` masks a value, `#` identifies a TOTP seed, and `_` identifies a card with separately copyable PAN/date/CVV. The third slot is hidden; Paste targets only empty parts and populated parts require source Edit. New Security templates and newly converted Authenticator records use v2. Existing unversioned blocks/headers retain literal pipes and legacy `#`/`_` labels; activating an existing header requires an explicit marker and review/escaping, not automatic migration. Managed `file`/`created`/`updated` stay read-only.

### Fixes

1. Retire stale code-preview callbacks after source or note changes so detached controls cannot mutate a replacement document.
2. Preserve Mermaid visual drafts and focus across the temporary source toggle; reject Apply when the underlying source has changed.
3. Improve coarse mobile contrast, menu placement and multi-part field layout so controls remain readable without overflow.

Compatibility: Standard Notes AIC 29.4.3, shared core 4.2.0 and universal VSIX. No authentication or note-synchronization change. Masking is visual, not Markdown encryption; raw source, exports and copied values can contain plaintext.

## 37.1.4 — 2026-09-13

Release sequence 37 · 1 feature outcome · 4 fixed-bug outcomes.

### Feature

1. Replace the separate Properties table with the shared Security-card renderer. Managed `file`, `created` and `updated` are copy-only; root and nested custom YAML fields support explicit `*` masking, empty-field clipboard actions and source-only editing of filled values. The read-only related-note tree follows metadata without entering Markdown. Ordinary `.md` receives no generated properties.

### Fixes

1. Keep nested, quoted and multiline YAML values, comments and source ownership intact during targeted Properties actions rather than rewriting unrelated content.
2. Preserve exact numeric scalars and the original `created` scalar type through note metadata saves; copied values remain original even when dates are formatted for display.
3. Preserve unchanged Security block DOM and live actions during Properties cursor/selection changes, while retiring stale detached callbacks.
4. Redact starred Properties from unfinished or truncated note excerpts, including nested secrets. Raw Markdown, exports and copied values remain plaintext.

Compatibility: Standard Notes AIC 28.1.4, shared core 4.1.0 and universal VSIX. No new runtime dependency, authentication or note synchronization change. The 36.4.4 recovery-code, security-title and save-boundary work remains available but is not counted as new in this release. Publication requires separate artifact verification.

## 36.4.4 — 2026-09-12

Release sequence 36 · 4 feature outcomes · 4 fixed-bug outcomes.

### Features

1. Mirror hidden recovery-code batches: paste one code per line, copy codes independently and retain reversible Used flags without deleting values.
2. Delete empty security fields directly from preview; populated fields remain protected.
3. Optional section titles replace the security card name in its header without a duplicate row.
4. Use the shared Save/Ctrl+S/leave-editor policy in main and linked-note editors. Security preview mutations request immediate saves; parent managers serialize requests and report acknowledgements, queued newer drafts and failures without per-keystroke autosave.

### Fixes

1. Repair security controls after CodeMirror viewport remounts, including immediately after conversion and scrolling. Old DOM callbacks and timers remain retired.
2. Hide Paste completely on filled fields; clipboard actions never replace a populated value.
3. Improve shared security/control contrast and the paired Standard Notes editor's light/dark theme handling and save-state feedback.
4. Remove the unreadable File Context sphere completely: view, toggle, setting, background graph analysis and bundled runtime. Linked Note, the Notes & Documents tree and parent-note relationships remain intact.

Compatibility: universal VSIX, Standard Notes AIC 27.4.4, shared core 4.0.0. The core major removes the experimental sphere exports. No new runtime dependency, authentication or synchronization changes. Raw Markdown and clipboard values remain plaintext.

## 35.0.1 — 2026-09-12

Release sequence 35 · 0 feature outcomes · 1 fixed-bug outcome.

### Fix

1. Mirror the canonical security-import persistence fix in AIC Editor Core 3.7.1: save-capable hosts can explicitly convert and save through their own manager, with acknowledged success, safe retry and stale-session guards. Standard Notes 26.0.1 uses this to retain mobile conversions after reopening. VS Code keeps its existing Convert to security blocks action followed by Ctrl/Cmd+S; no input or blur autosave is introduced.

Compatibility: universal VSIX, Standard Notes AIC 26.0.1, shared core 3.7.1. Authentication, synchronization, clipboard actions and the file-context sphere are unchanged.

## 34.1.0 — 2026-09-12

Release sequence 34 · 1 feature outcome · 0 fixed-bug outcomes.

### Feature

1. Mount the shared Authenticator JSON converter in both main Markdown and linked-note editors. Conversion produces one masked security block per record in one undoable draft edit. Strict all-or-nothing validation preserves credential strings and rejects duplicate keys, unrepresentable fields and unsafe nested Markdown contexts. Clipboard access, account scanning, automatic saving and native note-type migration are not involved.

Compatibility: universal VSIX, AIC Editor Core 3.7.0, Standard Notes AIC 25.1.0. Authentication, synchronization, clipboard actions and the file-context sphere are unchanged.

## 33.0.1 — 2026-09-12

Release sequence 33 · 0 feature outcomes · 1 fixed-bug outcome.

### Fix

1. Security Paste directly reads the latest system clipboard text only for empty fields, without an AIC picker, intermediate input or visible reading panel. Filled fields keep a disabled Paste icon; no Replace flow exists. Copy remains available, while changing a populated value requires complete Markdown Edit. Empty, failed or stale reads cannot overwrite fields, and malformed non-string request IDs are rejected before native clipboard access. Inline masked paste-only capture remains a fallback solely when API access fails. No clipboard-history collection or platform helper is added.

Compatibility: universal VSIX, AIC Editor Core 3.6.1, Standard Notes AIC 24.0.1. Explicit saving, password generation and authentication-only Standard Notes integration remain unchanged.

## 32.2.1 — 2026-09-12

Release sequence 32 · 2 feature outcomes · 1 fixed-bug outcome.

### Features

1. Security field clipboard actions are shared with Standard Notes: tap/click label or value copies only its value and acknowledges success beside that field; the field icon pastes. An identity-bound, timed native clipboard manager serves both main and secondary editors without entering save queues. Filled-field replacement requires confirmation, empty clipboard text cannot erase, and late reads cannot affect a different document or source-edit session. Whole-block Copy remains.
2. Shared empty-password generation uses WebCrypto randomness only: default 24 characters, all four character classes enabled, configurable length 8–128. Enabled classes are guaranteed with unbiased sampling. Existing values cannot be regenerated until cleared through source Edit. TOTP/API keys are excluded; generation never reveals or automatically copies the password.

### Fix

1. Security field controls have explicit theme colors, mobile 44px touch targets and distinct keyboard navigation. Tab never copies; Enter/Space activates. Preview mutation stays masked, with manual source edits and saving still explicit.

Compatibility: universal JavaScript VSIX, AIC Editor Core 3.6.0, Standard Notes AIC 23.2.1. No new dependencies or platform executables. Standard Notes remains authentication-only in VS Code. Security blocks mask plaintext; they are not a separate encrypted vault.

## 31.3.8 — 2026-09-12

Release sequence 31 · 3 feature outcomes · 8 fixed-bug outcomes.

- F01: shared `/security` blocks provide explicit masking, independent sections, Copy field/
  block, safe URL Open, source Edit, insertion actions and locally derived TOTP codes.
  Markdown and copied blocks remain plaintext; this is not an encrypted secret store.
- F02: opening a note in the main editor follows its nearest existing parent note in the
  sidebar, with project-note/placeholder fallback and an independent Open Source action.
- F03: enable the movable File Context sphere above linked notes, including an empty state,
  open/changed/pinned files, bounded relative JS/TS imports and existing note relationships.
  Active-file focus rotates the sphere; a command toggles its independent view. This is not
  a function-call, attribute or language-server graph.
- B01: serialize native sign-in startup/prompt ownership, make email submission stable and
  retire obsolete prompt callbacks. Real-account sign-in remains a user acceptance check.
- B02: confine relative file/wiki/note actions to the originating workspace and reject unknown
  sphere identifiers instead of accepting arbitrary paths from a webview.
- B03: revalidate origin, revision and ownership around save/create/trash/navigation; retain
  drafts across races, never implicitly save selection sources, and dispose child surfaces.
- B04: share task controls, details parsing and language aliases; preserve nested-control
  selection and retire detached actions and identity-bound preview sessions.
- B05: reject foreign drag payloads and duplicate property keys; preserve trailing authored
  cells in ragged tables and guard stale property/table actions.
- B06: require workspace trust and an existing explicit agent-workflow opt-in before automatic
  instruction refresh; activation alone no longer rewrites global agent instructions.
- B07: preserve authored ordinary Markdown metadata, and retry retired-storage cleanup after
  genuine removal failures instead of recording incomplete cleanup as complete.
- B08: bound Mermaid queues/model size, prevent resource-sensitive source configuration
  overrides, and dispose sphere observers/listeners and security-widget timers.

Compatibility: universal JavaScript VSIX, AIC Editor Core 3.5.0, Standard Notes AIC 22.1.8.
Standard Notes account support remains authentication-only; no note synchronization is enabled.
See FUNCTIONAL_INDEX.md for owners, contracts, controls and explicit limitations.

## 30.0.1 — 2026-09-11

Release sequence 30 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: correct authentication response handling: accept UTF-8 JSON with a leading BOM,
  preserve both auth cookies when Electron folds Set-Cookie headers, and report HTTP
  rate limits and verification challenges even when their response body is not JSON.
  Rejected responses now identify the fixed protocol stage and validation category;
  credentials, tokens and raw server responses never enter these diagnostics.
- Regression checks reproduce the old failures and the fixed behavior in an isolated
  VS Code extension host, including both Node and Electron fetch implementations.
  Synthetic protocol checks do not establish a successful real-account sign-in.
- Authentication only. No synchronization, shared-core changes, context sphere,
  parent-note routing changes or general refactoring are included in this hotfix.

## 29.1.0 — 2026-09-11

Release sequence 29 · 1 feature outcome · 0 prior-release bug outcomes.

- F01: optional Standard Notes authentication in the VS Code host: visible account action,
  native email/password/TOTP prompts, local protocol-004 derivation, verified session,
  SecretStorage persistence, connection checks and explicit sign-out. No synchronization,
  note import, note upload, tag management or remote note deletion is present.
- The universal JavaScript-only build uses pinned @noble/hashes 2.4.0; Windows and Linux
  tests/builds must pass before the release job publishes a VSIX and SHA-256 sidecar.
- Supports the hosted api.standardnotes.com service and protocol 004. Security-key and
  human-verification challenges are reported explicitly, not bypassed. Real-account sign-in
  requires a user smoke test; mocked protocol checks are not a live authentication result.
- Shared editor core remains 3.4.0, matching Standard Notes plugin 21.3.5. The unfinished
  context sphere is not enabled or bundled; the Standard Notes plugin does not need an update.

## 28.4.5 — 2026-09-11

Release sequence 28 · 4 feature outcomes · 5 fixed-bug outcomes.

- F01: share Core-aligned page/section/context/implementation prompts, Noise-to-Wave note guidance,
  and basic unordered, numbered, checkbox and table blocks. `/checklist` is discoverable through
  `checkbox` and `tasklist`; no mandatory page scaffolding is added to basic blocks.
- F02: edit flowchart, class and sequence diagrams directly in the Mermaid preview. A shared
  semantic palette, compact context bars, connection dragging, line controls and on-demand
  endpoint/member popovers use Mermaid layout, with exact-source fallback for unsupported syntax.
- F03: share heading and list formatting shortcuts with Standard Notes, preserving nested list
  ownership, source selection, one transaction and protected structured boundaries.
- F04: expose the same slash catalog in native VS Code Markdown completion, including untitled
  documents, alongside the AIC main editor and contextual note pane.
- B01: remove overlapping slash-menu headers, keep narrow/dark menus readable and activate
  suggestions immediately without duplicating commands.
- B02: preserve Enter indentation and Tab/Shift+Tab behavior in Markdown, fenced languages and
  Mermaid source fields while retaining snippet navigation and native source Undo.
- B03: stabilize preview/source selection, cursor navigation, code/details boundaries and
  source-bound diagram sessions; stale render results cannot replace the current diagram.
- B04: open notes in the main editor and keep Open Source separate, retain legacy associations,
  use project fallback with no active buffer, and protect main/sidebar ownership and save/navigation
  races without discarding unsaved drafts.
- B05: remove duplicate note headers, distinguish saved/dirty/placeholder states, acknowledge
  explicit saves exactly, and show only note-bearing context ancestors plus navigable project/current
  placeholders. Input and blur still do not save.

Compatibility: one universal VSIX for VS Code/Code 1.106 or newer on Windows, Linux, macOS and
code-server. AIC for Standard Notes 21.3.5 consumes the same AIC Editor Core 3.4.0. Cross-application
synchronization is not restored. Agentic Notes scope/section utilities are tested internal
foundations, not an enabled universal agent transport or standalone writer. The bounded visual
diagram editor remains experimental; unsupported grammar retains a lossless source fallback.

## 27.1.1 — 2026-09-03

Release sequence 27 · 1 feature outcome · 1 fixed-bug outcome.

- F01: divide the shared slash catalog into seven visible, task-oriented groups: Page templates,
  Page structure, Risks & verification, References, Tables & lists, Diagrams, and Content blocks.
  Existing pages rank their structural sections first; empty documents still rank complete page
  templates first. Both the full AIC Markdown editor and contextual note pane mount this same core.
- B01: make the slash menu, group headers, detail panel, selection, and snippet fields use the
  shared editor background/foreground/accent tokens with selectors that override CodeMirror's
  light base theme. Dark hosts no longer receive a white completion surface, and the real
  `completion-section` elements render as sticky labeled dividers.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The extension remains local-only; AIC for Standard Notes 20.1.1 consumes the same
AIC Editor Core 3.3 slash catalog, grouping, theme contract, and completion behavior.

## 26.1.0 — 2026-09-03

Release sequence 26 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: add a byte-identical slash-snippet core to AIC Notes and AIC for Standard Notes. Typing `/`
  on an otherwise empty Markdown line opens a contextual catalog of complete documentation pages,
  page sections, and formatting blocks. Each insertion is a usable example whose perspective
  questions are editable CodeMirror snippet fields; `Tab` advances through them. Empty notes rank
  page templates first, existing pages rank sections first, and code/read-only contexts stay
  untouched.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The extension remains local-only; AIC for Standard Notes 19.1.0 consumes the same
AIC Editor Core 3.2 slash catalog, query boundary, insertion behavior, placeholder, and menu styling.

## 25.0.3 — 2026-09-03

Release sequence 25 · 0 feature outcomes · 3 fixed-bug outcomes.

- B01: expose every replaced preview range through CodeMirror's public `atomicRanges` contract.
  Arrow-key and deletion commands now cross code, Mermaid, table, properties, Details, and link
  previews as stable units instead of entering hidden Markdown and rebuilding the layout midway.
- B02: give fenced-code Edit an explicit source-open state in the byte-identical shared core. The
  opening fence, language label, body, and closing fence remain ordinary editable Markdown while
  the selection stays in that block, including a cursor or selection at either boundary.
- B03: release-gate the new AIC Editor Core 3.1 navigation module and code-fence core 1.1 so the VS
  Code extension and Standard Notes component cannot drift on this interaction again.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The extension remains local-only; AIC for Standard Notes 18.0.4 consumes the same
shared navigation and fence-edit state.

## 25.0.2 — 2026-09-03

Release sequence 25 · 0 feature outcomes · 2 fixed-bug outcomes.

- B01: replace the duplicated preview-selection listener with AIC Editor Core 3.0, shared
  byte-for-byte with AIC for Standard Notes 18.0.3. Native mouse selection inside rendered code,
  tables, properties, and other preview DOM now stays stable and copyable instead of being destroyed
  on `pointerup`; explicit Edit and `Ctrl+A`/`Cmd+A` retain their source-reveal behavior.
- B02: restrict Details preview recomputation to document/selection, read-only, and Details-owned
  effects. Unrelated editor effects no longer rebuild its decoration sets during an active
  interaction.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The extension remains local-only; the shared editor core adds no Standard Notes
authorization, account access, synchronization, or remote state.

## 24.1.0 — 2026-09-03

Release sequence 24 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: share the complete CodeMirror code-fence extension byte-for-byte with AIC for Standard Notes
  17.2.0. Fence discovery, Mermaid exclusion, preview replacement, source selection, read-only
  labeling, viewport refresh, and exact-body Copy/Edit behavior now have one implementation; VS Code
  supplies only its clipboard host callback. AIC Editor Core advances to 2.9.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The local-only boundary is unchanged; shared editor code adds no Standard Notes
authorization, account access, synchronization, or remote state.

## 23.1.0 — 2026-09-03

Release sequence 23 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: move the code-fence preview card into AIC Editor Core 2.8 and consume the same
  byte-identical dependency-free implementation as AIC for Standard Notes 16.1.1. The existing VS
  Code language caption, exact-body Copy action, explicit Edit/source reveal, locked-source label,
  and text-safe scrollable rendering are now a release-gated paired-editor contract instead of a
  VS Code-only widget implementation.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. The local-only boundary is unchanged; sharing editor presentation code does not add
Standard Notes authorization, account access, synchronization, or remote state.

## 22.1.1 — 2026-09-02

Release sequence 22 · 1 feature outcome · 1 fixed-bug outcome.

- F01: make AIC Notes a fully local extension. Remove Standard Notes authorization, import,
  synchronization, conflict resolution, remote identity/tag state, remote Trash handling, API
  configuration, the Go/WebAssembly bridge, and their platform-specific packages. Existing local
  Markdown files are never removed; retired credentials, sessions, and workspace bindings are
  cleaned locally during upgrade without contacting a remote service.
- B01: isolate every editor action from network state. `Ctrl/Cmd+S` now has one deterministic local
  persistence path, Trash affects only the selected local sidecar, the pane reports only local
  saved/dirty/placeholder state, and disconnected-account errors can no longer interrupt editing.

Compatibility: VS Code/Code 1.106 or newer on Windows, Linux, macOS, and code-server through one
universal VSIX. AIC Editor Core 2.7.0 remains shared with the independent Standard Notes editor
plugin; no account connection or data synchronization exists between the products.

## 21.0.1 — 2026-09-02

Release sequence 21 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: when no file buffer is active, show the lazy project-root note instead of retaining an old
  file note or an empty Secondary pane. Multi-root workspaces prefer the most recently active
  project and fall back to the first workspace; Pin and unsaved drafts remain authoritative.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. Paired editor contract: Standard Notes 15.1.2
and AIC Editor Core 2.7.0. No Marketplace/Open VSX publication is implied.

## 20.1.6 — 2026-09-02

Release sequence 20 · 1 feature outcome · 6 fixed-bug outcomes.

- F01: add a release-gated functional index for every surface, command, state boundary,
  interaction, side effect, failure mode, platform adapter, and verification owner. Tests require
  every public command to remain both registered and indexed, and both VSIX archives ship the map.
- B01: make the active custom-editor tab authoritative over stale native editor state, route only
  the active note tab, remove implicit pinning from every open path, suppress follow events caused
  by exact-tab closure, never drop a second rapid tab event, and serialize navigation so slower
  requests cannot restore an older note.
- B02: derive Secondary footer capabilities from the actual surface: Open source is available for
  every known file/folder/project owner including a placeholder, Trash for every existing writable
  note, and Pin for any note or placeholder. These actions no longer disappear merely because the
  pane is unpinned.
- B03: generate exactly `file`, `created`, and `updated` for every lazy sidecar placeholder and
  remove the retired seven-field seed API. Old frontmatter embedded in project templates is treated
  as non-body configuration and cannot leak into a fresh placeholder. Explicit save safely migrates
  the exact old generated signature while preserving every additional authored property.
- B04: classify missing authorization, unreadable sessions, and unavailable secure storage as
  passive disconnected states throughout activation, project reconciliation, ordinary Markdown
  save, and Secondary background save. Local persistence succeeds without repeated error toasts or
  an automatic login prompt; explicit connection actions still report actionable failures.
- B05: keep Mermaid fit/zoom dimensions independent of rotation. Quarter-turns swap stable source
  bounds instead of fitting the rotated width again, avoiding extreme aspect-ratio growth while
  preserving real horizontal and vertical scrolling.
- B06: serialize identical tag release runs and make asset publication idempotent, so a duplicated
  GitHub tag delivery updates verified assets instead of leaving a false-red pipeline.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. Paired editor contract: Standard Notes 15.1.2
and AIC Editor Core 2.7.0. No Marketplace/Open VSX publication is implied.

## 19.1.1 — 2026-09-02

Release sequence 19 · 1 feature outcome · 1 fixed-bug outcome.

- F01: add permanent icon-only Mermaid zoom, reset, and clockwise quarter-turn controls to both
  read previews and the live editing preview. Rotation advances through 0°, 90°, 180°, and 270°;
  Reset restores both scale and direction without exposing the fenced source.
- B01: replace the conflicting transform-only overflow rules with AIC Editor Core 2.6's shared
  two-dimensional viewport and explicit transformed stage bounds. Enlarged diagrams now scroll on
  both axes after zoom or rotation instead of being clipped by the outer preview card.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 18.1.3 — 2026-09-02

Release sequence 18 · 1 feature outcome · 3 fixed-bug outcomes.

- F01: replace the terminal `sn_remote_ambiguous` notification with a one-time identity resolver.
  A unique local-body match binds automatically; otherwise the picker shows dated previews for all
  Standard Notes copies plus a local-content option. The selected UUID and common base persist in
  workspace state, while every unselected remote copy remains untouched and recoverable.
- B01: honor explicit local/remote resolution when a first binding has no common ancestor. Previous
  builds returned the same conflict after either button, so initialization or the next save could ask
  indefinitely without ever establishing a binding. Read-only items now also permit an explicit pull.
- B02: treat historical duplicate active project-root tags as physical branches of one logical
  project inventory. Import includes every branch; synchronization follows the branch containing the
  exact note and chooses a deterministic branch only for new attachments, without deleting tags or
  remote notes.
- B03: separate malformed tag graphs from duplicate note identities in the bridge protocol. Invalid
  parent/path structures now retain a distinct stable error, while divergent valid note candidates
  reach the resolver instead of being collapsed into the generic `sn_remote_ambiguous` failure.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 17.3.3 — 2026-09-02

Release sequence 17 · 3 feature outcomes · 3 fixed-bug outcomes.

- F01: limit generated `file`, `created`, and `updated` properties to `*.note.md`; preserve every
  authored note property and body; localize dates only in preview; and remove the exact legacy
  generated header from ordinary Markdown on explicit save without adding replacement metadata.
- F02: move table and Properties editing into one transient popover per selected cell. Static values
  stay selectable, flexible columns size to content without breaking words, overflow scrolls
  horizontally, and table copy plus every preview action uses renderer-independent CSS-mask icons.
  AIC Editor Core 2.5 provides the byte-identical structured/property contract to both editors.
- F03: make the project note the first, explicitly named Notes Explorer row and expose the same
  action in the view title. Its placeholder remains gray and creates the real root sidecar only on
  first edit plus Ctrl/Cmd+S; ordinary Markdown remains visually and behaviorally a document.
- B01: force a complete CodeMirror syntax tree before constructing code, table, and frontmatter
  previews, preventing partially initialized blocks and first-render table/property gaps.
- B02: carry exact word selections from the AIC Markdown webview to the extension host. The linked
  comment shortcuts now work in both native and custom editors, retain the selected source fragment,
  open the details block, and place the caret in its comment body. Edit, selection, comment, and save
  messages cross that boundary in one ordered queue, so a comment can never anchor to stale bytes.
- B03: make initialization, import, discovery, and save share one Standard Notes identity contract.
  Identical unbased content no longer prompts as a conflict; byte-identical duplicate notes and empty
  duplicate tag shells choose a stable canonical UUID; a tagged project root suppresses the legacy
  untagged fallback; inconsistent sidecar titles fail closed; and free-standing `*.note.md` filenames
  remain stable across import and subsequent saves. Both bridge targets are rebuilt with pinned Go
  1.25.1.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 16.2.1 — 2026-09-01

Release sequence 16 · 2 feature outcomes · 1 fixed-bug outcome.

- F01: add a permanent Copy action to parsed and fallback table previews. It sends the exact
  Markdown table source through the existing VS Code clipboard bridge and reports success by
  changing only the accessible icon state.
- F02: replace textual preview, link, details, Mermaid, zoom, drag, and Secondary footer actions
  with custom icon-only buttons. AIC Editor Core 2.4 supplies the shared button and feedback
  contract; embedded SVG data URIs are painted exclusively through CSS masks, so action rendering
  does not depend on inline-SVG support. Every control retains an explicit `aria-label`, while
  redundant native title tooltips are removed.
- B01: make the release gate generate SHA-256 sidecars from the CI-built VSIX files after the pinned
  bridge build, verify those exact artifacts, and publish both platform packages plus checksums to
  the tagged GitHub Release. Checksums no longer depend on locally generated ZIP bytes.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 15.1.0 — 2026-09-01

Release sequence 15 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: reduce managed properties for ordinary Markdown files to `file`, `created`, and `updated`.
  Manual Ctrl+S/Cmd+S reads the filename and portable VS Code file creation time, preserves an
  existing creation value and the complete Markdown body, and applies a fresh UTC update timestamp
  through `onWillSaveTextDocument` before local persistence and Standard Notes synchronization.
  Concurrent document changes invalidate the pending metadata edit, and `*.note.md` sidecars stay
  byte-identical. AIC Editor Core 2.3 provides the same pure transform to the Standard Notes plugin.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 14.2.0 — 2026-09-01

Release sequence 14 · 2 feature outcomes · 0 fixed-bug outcomes.

- F01: make table previews readable at every editor width. Header and body cells use wrapping,
  auto-height textareas; the grid fills the card without a blank right-hand zone, and a dedicated
  body scroller provides horizontal navigation when the minimum readable column widths exceed the
  pane. The action header remains fixed and Properties inputs stay compact and single-line.
- F02: bridge selection from preview DOM back into CodeMirror. Ctrl+A/Cmd+A now selects the complete
  Markdown document even when focus is inside a table cell or another preview control, while a real
  mouse selection over a rendered block opens and selects that block's source. Browser-only
  selection can no longer leave the editor visually selected but non-editable.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 13.1.0 — 2026-09-01

Release sequence 13 · 1 feature outcome · 0 fixed-bug outcomes.

- F01: upgrade the shared AIC Editor Core to 2.2 and make source selection a universal escape from
  rendered previews. Ctrl+A/Cmd+A selects the complete Markdown document and reveals raw source for
  every intersected Properties, Table, Details, code, Mermaid, link, and inline-syntax view. A
  smaller non-empty selection reveals only the blocks it crosses; ordinary clicks and collapsed
  cursors retain preview behavior, and the visible **Edit** action remains available for focused
  source editing.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 12.0.1 — 2026-09-01

Release sequence 12 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: the in-process Standard Notes WebAssembly bridge now runs with a minimal, explicit runtime
  environment instead of copying the complete VS Code host environment. This removes Go/WASM's
  command-line/environment overflow on GitHub Actions and on enterprise installations with large
  inherited environments. The release gate exercises the regression with an oversized host value
  and builds both Linux and Windows VSIX artifacts before validating them.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 11.4.6 — 2026-09-01

Release sequence 11 · 4 feature outcomes · 6 fixed-bug outcomes.

- F01: a connected extension now bootstraps every open workspace as an inventory reconciliation:
  it pulls the complete Standard Notes project tag subtree, imports missing canonical sidecars,
  binds existing matches without resetting their common ancestor, synchronizes every substantive
  local note whether opened or not, and refreshes Explorer. A remote sidecar whose target is gone
  is imported as an orphan when its real parent directory still exists.
- F02: the Properties preview now includes a dynamic, read-only context tree for project, parent,
  current, component, and sibling notes. It also appears in editable placeholders, offers lazy
  higher-level candidates, opens a selected relationship in Secondary, and is absent when the
  Markdown document has no valid properties block.
- F03: Standard Notes inventory and save synchronization now cover every workspace `*.md` file,
  not only `*.note.md` sidecars. Remote Markdown filenames materialize at their exact project-tag
  path, local documents push or pull on explicit Ctrl+S/Cmd+S even in the native editor, and the
  project tree labels sidecars as **Note** and ordinary Markdown as **Document**. A document edited
  during an in-flight pull keeps the newer local text and asks for another save.
- F04: upgrade the shared AIC Editor Core to 2.1 and render nested YAML maps and sequences as a
  hierarchical Properties preview. Indentation and list levels remain visible, leaf values are
  directly editable, structural groups cannot become invalid scalars, and drag-and-drop moves a
  complete branch only among valid siblings. Unsupported YAML stays safely in raw source mode.

- B01: opening a lazy project note now closes any stale main-editor tab before focusing the
  Secondary Side Bar. If a bound sidecar disappears between actions, the pane reconstructs its
  editable owner-backed placeholder instead of asking VS Code to open the nonexistent file.
- B02: linked-code accordions keep their body directly editable for comments, their task checkbox
  owns its click without a CodeMirror recreation race, and long summaries wrap instead of
  compressing the checkbox and source actions.
- B03: Secondary drafts no longer save on input or blur. Ctrl+S/Cmd+S is the only persistence and
  sync boundary; dirty drafts visibly say `Unsaved`, saved notes receive a subtle green state,
  placeholders are gray, and navigation cannot discard an unsaved draft. A completed network sync
  records its new common base before applying remote text, so typing during the request does not
  create a false conflict on the next save.
- B04: Properties and Table now start in preview regardless of the initial cursor. Repeated or
  double clicks cannot expose raw Markdown; only **Edit** enters source mode, and leaving the block
  restores preview.
- B05: link **Copy** and **Edit** actions remain visible instead of reserving an empty hover-only
  gap, keeping link interaction compact and immediately understandable.
- B06: recover legacy canonical project notes that were created outside the project tag, bind and
  migrate them without duplication, and make Explorer deletion remote-first. A bound Standard
  Notes item reaches recoverable Trash before its local sidecar; failed local Trash retains the
  binding for an idempotent retry, while each successfully removed file clears only its own binding.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 10.4.2 — 2026-08-31

Release sequence 10 · 4 feature outcomes · 2 fixed-bug outcomes.

- F01: introduce AIC Editor Core 2.0, a dependency-free structured-preview contract shared
  byte-for-byte with the Standard Notes component. Table/property mutation, validation,
  serialization, reorder behavior, and the compact link control no longer diverge by host.
- F02: replace the cursor tooltip with one direct link control. Clicking the label opens the link;
  adjacent **Copy** and **Edit** actions remain explicit, and bare URLs use the same interaction.
- F03: table previews now edit headers and cells in place, add rows or columns, and reorder either
  dimension with drag handles while persisting one valid Markdown table transaction.
- F04: properties previews now edit keys and values in place, validate simple YAML keys, add unique
  properties, and reorder rows with drag handles while Markdown remains the sole stored value.
- B01: focus moving between structured controls no longer triggers an early save. A Secondary draft
  commits only after focus leaves the complete editor surface or through Ctrl+S/Cmd+S.
- B02: a missing sidecar recovers as its source-backed placeholder, and a dirty attached draft can
  recreate the sidecar. Save races retain the draft instead of surfacing a disruptive host error.

Compatibility: VS Code/Code 1.106 or newer; Windows x64 uses the bundled in-process WebAssembly
bridge and Linux x64 uses the bundled static helper. No Marketplace/Open VSX publication is implied.

## 9.0.1 — 2026-08-21

Release sequence 9 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: Standard Notes tagging now creates or reuses the native
  `<project> → <parent> → <child>` graph with official `TagToParentTag` references. Only the leaf
  references the note, exact managed UUIDs drive later migration and Trash cleanup, and same-title
  children under different parents remain distinct. Existing dotted/legacy AIC references migrate
  without touching shared or unrelated tags; duplicate or malformed candidates fail closed. A
  bridge without native nesting support falls back to the project tag only and never recreates a
  dotted pseudo-hierarchy.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Existing
`8.1.3` bindings migrate on their next successful writable sync. No Marketplace/Open VSX
publication is implied.

## 8.1.3 — 2026-08-21

Release sequence 8 · 1 feature outcome · 3 fixed-bug outcomes.

- F01: the pinned footer now has one confirmed two-sided **Move note to Trash** action. It targets
  only the exact bound Standard Notes UUID, moves that item to recoverable Trash, removes its
  AIC-managed tag reference, then trashes the local sidecar. Remote-first ordering, idempotent
  retries, and delayed binding cleanup prevent either side from being silently orphaned.
- B01: the Secondary note pane now uses the current Agents Window theme layers: an
  `agents.background` shell around an `agentsPanel.background` card with explicit border and
  foreground fallbacks, so notes remain visually separate from the editor across compatible themes.
- B02: raw Space is no longer captured as a task toggle. Typing `- [ ]` can now receive the
  required trailing space or task text and become a rendered checkbox; rendered checkbox clicks
  remain independently actionable.
- B03: empty/frontmatter-only notes, unchanged generated placeholders, and headings with only empty
  unchecked tasks are rejected before authentication or API access. Save, blur, and explicit sync
  therefore cannot create or overwrite remote content from a non-substantive scaffold.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Remote
Trash is recoverable Standard Notes state, never permanent deletion. No Marketplace/Open VSX
publication is implied.

## 7.3.2 — 2026-08-21

Release sequence 7 · 3 feature outcomes · 2 fixed-bug outcomes.

- F01: connected sidecars now synchronize after `Ctrl/Cmd+S`, attached-document saves, and
  Secondary editor blur. Per-note requests serialize and coalesce to the newest persisted body;
  automatic sync never prompts for credentials, and an in-flight remote pull cannot overwrite
  newer local edits.
- F02: fresh file notes now separate properties from an action-oriented `## Todo` and
  `## Open questions` seed, each with an empty checklist item. Workspace overrides and existing
  notes remain unchanged.
- F03: Secondary now follows every active source until pinned, presents a non-writing editable seed
  when its sidecar is absent, and creates the file on the first real edit. The crowded toolbar,
  manual Sync/Create/Docs controls, and auto-open checkbox are replaced by an icon-only footer;
  Source/Clear/Delete appear only while an existing note is pinned.
- B01: Standard Notes sync now assigns one dotted `<project>.<parent>.<child>` tag instead of three
  `aic`/`project:*`/`path:*` tags. Migration removes only AIC-owned references, retires empty legacy
  tags, records the exact new managed title, and preserves shared or unrelated user tags.
- B02: Open Linked Note now works outside editor text focus. Selection linking saves dirty sources,
  keeps the old chord as an alias, and adds layout-safe `Ctrl/Cmd+Alt+L` before opening the exact
  linked comment in Secondary.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Automatic
sync remains sidecar-only and requires an already readable local session; manual recovery remains
available as **AIC Notes: Sync Current Note**. No Marketplace/Open VSX publication is implied.

## 6.6.1 — 2026-08-21

Release sequence 6 · 6 feature outcomes · 1 fixed-bug outcome.

- F01: Details now renders as one continuous sidebar-contrast card. Its title and real rotating SVG
  chevron toggle the exact marker, while checkbox, linked-source, and **Edit source** remain separate
  controls; read-only disclosure is visual only.
- F02: the Secondary toolbar is compact, wraps at narrow widths, uses the current note filename as
  its native title, and exposes a clickable parent-folder breadcrumb plus Pin/Unpin, Source, and Sync.
- F03: explicit **Log in/Log out** reflects the readable local encrypted session. Logout confirms and
  removes only that local vault, preserving the SecretStorage key, bindings, notes, and remote data.
- F04: **Edit source** is now the only source-entry action for Details, Mermaid, Table, and
  Properties; preview content clicks and synthetic container keyboard activation stay in preview.
- F05: a compact Note menu adds confirmed frontmatter-preserving **Clear content** and Trash-first
  local **Delete note**, without remote mutation.
- F06: install/update integrates the canonical AIC agent workflow. A committed thin
  `.vscode/aic-agent.json` marker travels with a project, while typed `aic rules` commands provide
  current English practice, context-file lifecycle, documentation/diagram rules, bounded waves,
  and the literal GO-to-DONE gate across agents and devices without duplicated prompt text.
- B01: redirected or otherwise closed `*.note.md` documents retain their URI and reopen before
  edit/save/sync/replace, eliminating the observed `Document has been closed` failure without
  leaving a Primary editor tab.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. AIC agent
workflow integration requires an independently installed compatible AIC executable. No
Marketplace/Open VSX publication is implied.

## 5.3.1 — 2026-08-21

Release sequence 5 · 3 feature outcomes · 1 fixed-bug outcome.

- F01: the Secondary note surface is always an editor, with no Preview/Edit switch; a Standard
  Notes item lock or read-only session makes that same surface fixed read-only until a later manual
  sync reports write access.
- F02: selection links now use the AIC `>>>|open| Title` / `>>> Title` / `<<<` details contract. A
  new block starts open with a checkbox and compact source link in its summary, the copied code
  fragment and comment inside, and an arrow that toggles only that block's exact marker.
- F03: a new file-note body is reduced to the existing frontmatter properties and one empty
  checklist item; project/folder defaults and valid workspace overrides remain intact.
- B01: Standard Notes authorization no longer depends on a desktop Secret Service/keyring. The Go
  bridge stores its session in an authenticated AES-256-GCM vault while VS Code SecretStorage holds
  the independent wrapping key, so headless code-server can connect without `secret-tool`.

Compatibility: VS Code/Code 1.106 or newer; the bundled Standard Notes bridge is Linux x64. The
first sync after upgrading from 4.3.3 requests a new connection because legacy keyring sessions are
not read, migrated, or deleted. No Marketplace/Open VSX publication is implied.

## 4.3.3 — 2026-08-21

Release sequence 4 · 3 feature outcomes · 3 fixed-bug outcomes.

- F01: a compact Secondary layout keeps controls and Markdown readable in the narrow pane while
  retaining the AIC visual contract.
- F02: following a source without a sidecar shows a non-writing placeholder with the candidate path
  and an explicit **Create note** action.
- F03: a saved source selection can add one deduplicated linked-code annotation to the canonical
  sidecar and navigate back to the exact lines without modifying source bytes; `*.ai.md` ownership
  is verified fail-closed.
- B01: Secondary Edit now reliably focuses the input, accepts changes, serializes overlapping
  updates, and saves through the VS Code document model.
- B02: toolbar labels and actions now use explicit theme-safe foreground fallbacks, so controls no
  longer disappear on dark side-bar themes.
- B03: the Standard Notes helper now sends the current mandatory client headers, validates server
  URLs, preserves MFA, and returns sanitized actionable connection categories instead of the
  unhelpful generic `sn_connect_failed` path where a safe classification exists.

Compatibility: VS Code/Code 1.106 or newer. Standard Notes sync remains Linux x64 only. Selection
links use persisted one-based line anchors. No Marketplace/Open VSX publication is implied.

## 3.4.0 — 2026-08-21

Release sequence 3 · 4 feature outcomes · 0 fixed-bug outcomes.

- F01: `.note.md` is Secondary-Side-Bar-only, with follow/pin, preview/edit, exact-tab
  interception, configurable `Ctrl/Cmd+Alt+N`, a workspace auto-open checkbox, and an ordinary-file
  note icon. The Primary Side Bar remains the existing-note manager.
- F02: ordinary Markdown and Secondary sidecars share the current Standard Notes AIC visual/editor
  contract while persisting exact Markdown only.
- F03: a manual Linux x64 MIT Go bridge performs encrypted Standard Notes sync with keychain-backed
  sessions, stable remote UUIDs, three-way comparison, and explicit conflict choice.
- F04: sync reconciles exact `aic`, `project:<root>`, and `path:<parent>` managed tag references while
  preserving every unrelated tag.

Compatibility: raises the extension-host floor to VS Code/Code 1.106. Standard Notes sync in this
release is Linux x64 only. No Marketplace/Open VSX publication is implied.

## 0.7.1 — 2026-07-06

- Fix: diagrams actually take the full available width — mermaid's inline
  `max-width` on the svg was overriding the full-bleed layout; zoom now
  scales from the true pane width.

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
