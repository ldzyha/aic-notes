# Functional index

This index records the coordinated AIC Notes 48.0.1 / Standard Notes AIC 40.0.1 /
shared editor core 6.2.2 release target. Public commands, state boundaries, side effects and
failure rules are checked by tests and the release archive verifier; this is not a claim of
exhaustive runtime coverage or that publication has already completed.

Release 48.0.1 gives information (`>`), warning (`!>`) and error (`!>>`)
quotes distinct accents and more spacing. Quote and italic text are smaller.
An unclosed code fence stays editable, and a complete fence remains source
while the caret touches it. `>>> … <<<` remains details. Authored Markdown is
unchanged.

Release 47.0.1 separated headings, quotes and list starts,
and draws a 50–100 px centered thematic break with vertical space. Its line
height stays stable when the caret reveals raw source. Source text is unchanged.

## Shared-core changes in release 46.1.1

New AIC blocks begin with an unlabeled text row instead of the Account preset;
Password and TOTP remain separate optional fields. Narrow field rows wrap their
labels and typed values together into readable columns. Password generation is
hidden at viewport widths of 600 px or less, without hiding saved secrets or
their copy actions. Existing authored notes are not rewritten. The same core
rules reach Standard Notes and browser 0.5.0.

## Shared-core changes in release 45.1.0

One feature: Copy section in each AIC section header copies a standalone fenced
`aic` block containing only that section. It includes masked and filter-hidden rows,
excludes the card title and sibling sections, and preserves logical labels, value
text and typed parts through the shared serializer. Authored whitespace/quoting may
be normalized. Both main and Linked Note surfaces use the same clipboard owner,
feedback and stale-widget guards; read-only views can copy without source mutation
or a save request. Core 6.1.0 adds this action without changing the current grammar.

Browser 0.4.0 separately adds one Global Shared record in its encrypted profile
vault. VS Code does not gain that record, account connections or synchronization.
The proposed generated-key and VS Code `global.aic` encryption architecture remains
unimplemented. This release makes no Standard Notes PWA crash-fix claim.

## Prior shared-core changes in release 44.4.7

Four feature outcomes are the retired native Notes & Documents tree, the aic-only
document format, the shared local guide, and typed-pipe values (including one-time
states). Seven fixes include card/composite labels and first values using the same grid, typography and
alignment as adjacent simple fields, without the extra card-label colon. Contextual
Field/Row/Section actions follow the relevant row; empty sections keep Row/Section
inline without a dedicated footer. Shared field-add menus use compact left-aligned items rather than oversized
centered rows. Masking, independent copy targets, existing field actions, menu bounds
and keyboard behavior remain. Linked-note headers omit file dates, and the main note
footer has one source/preview toggle while Secondary retains its distinct owner
navigation action.

Core 6.0.0 replaces colon/YAML field interpretation with independently typed
`|`, `*|`, `#|`, `_|`, `1|`, and `0|` values. Old text remains raw and no save
path migrates or stamps it. Add Field/Row/Section targets the current row, below
the current row, and after the current section. Core retains the additive card
shared BEM compatibility contract. Compatibility
selectors and host-specific placement remain; this does not claim a completed BEM
migration. The release does not include the separately proposed global
Shared/encryption design or change VS Code's local-only boundary.

## Prior shared-core changes in release 43.0.1

One fix: card fields display their optional label, masked last four digits, expiry
and masked CVV in the shared compact inline composite row. Independent copy targets,
empty-part Paste, empty-field deletion and reordering retain their existing owners.

Core 5.3.0 adds shared component IDs, BEM-class helpers and geometry tokens through
the explicit distribution inventory. Adoption is additive and partial: registered
CodeMirror/data compatibility hooks and host placement rules remain. Shared preview
layout now owns common shell, header and code-preview rules, without claiming that
all legacy selectors or host-specific styles have been removed.

## Prior shared-core changes in release 42.0.3

Three fixes: generic pipe fields display label, value and description in one compact
row with independent copying and local overflow; shared parsing avoids repeated
per-block full-tree scans. Properties/Security Add menus choose available viewport
space and dispose their positioning listeners. CodeMirror's actual caret uses a
visible 2 px host-themed stroke, including reduced-motion and forced colors.

Core 5.2.0 also exposes an additive read-only preview option for the separate browser
host. That API does not change VS Code editing defaults or add browser notebook UI,
accounts, synchronization, semantic zoom or a sphere to this extension.

## Prior shared-core changes in release 41.1.1

One feature: each Security and v2-marked custom Properties value slot supports optional
JSON-style double quoting. Quoted pipes, quote/backslash/control escapes retain logical values;
serialization quotes logical values containing a pipe or quote. Ordinary values may remain
unquoted. Labels and titles have no quote syntax. Properties retains YAML frontmatter:
`Password*: '"a | b" | "description"'` uses outer YAML single quotes to preserve inner
field-slot double quotes; YAML outer quoting alone does not protect a spaced separator.

One fix: only exact `|` outside quotes separates slots. Bare and one-sided pipes remain
data; legacy `\|` outside quotes still parses. Invalid quotes, escapes or trailing text
produce generic, non-secret errors; Security identifies exact source positions. Tests
must verify these contracts; host behavior and publication are separate gates.

## Prior shared-core changes in release 40.6.6

New Security content uses one unversioned `aic` fence grammar with optional section
labels. This breaking core change does not silently rewrite authored versioned Security
fences. Compact cards show the last four fields and compact multi-part card fields;
dragging fields can cross sections while preserving unrelated authored source. Properties
brings managed metadata, related-note navigation and custom fields into the compact
shared Security surface without making managed values editable. Labelled Add controls
show capacity and explain disabled-limit reasons.

Escape handling includes Mermaid fence boundaries; target feedback is transient and
stale-safe; label/value Copy are distinct; filtering does not reveal PAN; label/drag
styling stays usable on narrow layouts in dark and light themes; unchanged filtering
and rendering avoid repeated work. The VS Code host removes Standard Notes sign-in and
transport, leaving local-only editing. These are release-source contracts; tests and
artifact publication are separate gates.

## Prior shared-core changes in release 39.3.3

New Security templates/conversions use v3 with `---` section boundaries and optional titles;
unversioned/v2 notes retain their existing interpretation. Import packs accounts into one
block, spilling at canonical capacity and splitting oversized accounts at field boundaries
without dropping values. Preview exposes section/field/text/value limits and disables Add
actions that would overflow; New block remains available. Purpose examples recommend
separate blocks for services, banks, web and social networks.

Shared Security/Properties diagnostics identify line/column and navigate directly to source
without echoing credentials. New block safely closes an EOF-terminated previous fence first.
Exact-source whole-card reordering supports versioned v2/v3 fences without rewriting
their authored field syntax or unrelated text. These changes are mirrored from canonical
core, not independently implemented here; publication is verified separately.

## Authenticator JSON conversion

Shared `security-import` owns the bounded, lossless, all-or-nothing JSON-to-security mapping;
`security-import-extension` owns the contextual panel and atomic editor transaction in both
main and sidebar. Each record becomes a separate section, with capacity-based block overflow. Secret/password and extra string
fields are masked; duplicate keys and unrepresentable values never silently disappear.
Conversion acts only on the current document/selection, never the account or clipboard, and
requests a parent-managed save after conversion. Tests: `security-import`, canonical import model/UI suites and
production webview browser checks. Artifact publication is verified separately from source tests.

## Current release contracts

- Copy section uses `serializeSecurityBlock` to preserve the selected section's
  logical typed values in standalone AIC Markdown. Visual filtering never reduces
  the copied payload; masking does not redact explicitly copied values. The source
  document, read-only state and save state remain unchanged. Verification belongs
  to the canonical section-copy UI/model tests and mirrored shared-core checks.
- One bounded fenced `aic` document owns structured values. `|`, `*|`, `#|`,
  `_|`, `1|` and `0|` type the following part as text, secret, authenticator,
  card, unused one-time or used one-time data. A label is optional and one row can
  combine independently typed parts. Blank, Card and One-time codes are presets,
  not additional field types. New blocks include an unlabeled text row for an
  email or another identifier.
- Copying an unused one-time value changes it to `0|`; activating a used value
  restores `1|` without copying, and only used values expose removal. Field adds a
  typed part to the current row, Row inserts below it and Section inserts after the
  current section. All mutations retain stale/read-only/capacity guards.
- Legacy YAML Properties, colon fields and prior Security forms stay exact raw
  Markdown. They are not rendered, stamped, reordered or automatically migrated.
  The single source-mode button exposes raw Markdown temporarily for the current
  note; raw source can reveal visually masked values.
- The linked-note header shows no created/updated timestamp. VS Code may retain
  filesystem metadata internally, but it is not projected into the AIC field UI.
- The shared local `?` guide and canonical blank/card/one-time presets use
  only current grammar. The guide is fixed bundled DOM content with no storage or
  network access.
- Shared `save-boundary` reports focus-leave and security mutation intents to the host managers.
  Main and sidebar queues keep target identity, generation and ownership checks; saved colour
  requires acknowledgement. CodeMirror viewport remounts create fresh live widget sessions while
  detached controls, clipboard completions and TOTP timers remain retired.

- Shared password generation is available on viewports wider than 600px and remains
  bounded and WebCrypto-only. Authenticator
  codes derive locally from `#|` parts. Copy/open/mutation actions use the existing
  identity-bound host clipboard and save managers; VS Code has no note
  synchronization or QR import UI.

- `DisposableScope` owns provider subscriptions and child surfaces. Closing a surface retires its
  subscriptions and request waiters; provider disposal also retires still-open children.
- Queued and in-flight sidebar saves retain the originating view. Document version/text, note
  identity, generation and ownership are revalidated before mutation. An exclusive create edit
  refuses an intervening file; these guards do not claim arbitrary filesystem compare-and-swap.
- Trash does not save dirty notes. It rechecks view, revision and lease after confirmation,
  including a separately confirmed permanent-delete fallback.
- Link Selection to Note uses the active native/custom document, refuses unsaved source revisions,
  and delegates insertion to the live sidebar draft. No helper saves the source or target implicitly.
- Shared task markers enforce read-only state and keyboard/ARIA behavior in both products.
  Canonical details parsing is linear and cached per immutable document; language aliases and the
  cancelable bounded Mermaid queue have one shared implementation.
- Nested text controls retain native Ctrl/Cmd+A; whole-document Select All remains available in
  the Markdown surface. Browser regressions cover typing into an inline diagram label afterward.
- Core distribution is an explicit inventory. Unconnected experiments do not enter the mirror
  automatically, and a working-tree snapshot cannot pass the publication verifier.
- The retired File Context sphere and native Notes & Documents tree have no view,
  command, provider, watcher or scan runtime. Contextual parent-note relationships,
  Linked Note, source following and ordinary Explorer navigation remain independent.

The VS Code extension is local-only and has no Standard Notes account connection.
The contracts below describe this coordinated release target, not future sync behavior.

## Shared editor core 6.1.0

These contracts target AIC Notes 45.1.0 and pair with Standard Notes AIC 37.2.0.
The exact canonical commit and all shared hashes belong in CORE_SNAPSHOT.json after the
canonical source is committed and the mirror snapshot is regenerated; a working-tree
snapshot is not proof of committed release identity.
Automated tests, production builds and Windows browser checks cover the shared editor;
Linux desktop smoke checks are not implied.

| Area / owner                                                | Implemented contract                                                                                                                                          | Explicit limitation                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Shared templates and native completion                      | Core questions → answers → detail; `/noise`, `/wave`, `/implementation`, `/context`, `/entity-map`; contextual heading levels in `.md` and `.note.md`         | No automatic wave/noise state, dashboards or grouping UI                                                              |
| New-note bodies (`note-template`, `src/notes/templates.js`) | Shared Noise guidance evolves through `/wave` in the same note; custom template source remains authored and an empty body receives the valid AIC seed         | Existing notes are not rewritten; Standard Notes does not receive VS Code workspace templates                         |
| Shared diagram model/builder                                | Actual Mermaid SVG provides palette insertion, connection dragging, typed relationships, property editing, draft Copy, Undo/Redo/deletion and zoom/scroll/fit | Bounded flow/class/sequence grammar; no multiselect, subgraph authoring, visual timeline or arbitrary Mermaid support |
| Shared diagram session                                      | Inline Apply changes only the current block; outside edits preserve the draft; conflicting block edits/read-only retain a Copy-only draft; Ctrl/Cmd+S saves   | Cancel explicitly discards the draft; note identity changes retire the session; no cross-scale links                  |
| Layout and ordering                                         | Inline editing and read preview use the same Mermaid auto-layout; direction and sequence ordering are source semantics                                        | No arbitrary stored coordinates; legacy coordinates are ignored, and removed only after an actual visual edit         |

Usage: insert a diagram through `/`, choose **Edit diagram visually** on its AIC preview, edit and
Apply, then Ctrl/Cmd+S. Ctrl/Cmd+S within the builder combines Apply with the existing explicit save.
The native Markdown editor shares templates but remains a source editor. `/entity-map` describes
composition; `/timeline` stays chronological. Shared preview-spacing and session-lifecycle fixes
are implemented; completed cross-platform/live-client smoke testing is not implied.

## Product boundary

No Standard Notes account connection is offered by the VS Code extension. The independent
Standard Notes editor plugin owns its own host lifecycle; shared editor code does not connect accounts.

The AIC Markdown editor shares heading/list formatting commands with the Standard Notes
component: Ctrl/Cmd+Alt+1…6 (headings), Ctrl/Cmd+Alt+0 (paragraph),
Ctrl/Cmd+Shift+7/8/9 (numbered/bullet/checkbox lists). These shortcuts apply to both
`.md` and `.note.md` in AIC surfaces, not the native VS Code source editor. The shared
slash catalog supplies `/checklist` there as well, searchable by checkbox/tasklist.
Formatting is one local edit, never a save, and protects code/frontmatter/structured blocks.

- The note editor persists only local workspace `*.md` and `*.note.md` files. The optional
  trusted agent workflow may write its thin workspace marker and run AIC-owned global rule sync;
  neither path is note synchronization.
- There is no account sign-in, note synchronization, tag graph, conflict resolver, or remote
  note Trash action in the VS Code host. Saved notes remain local.
- The independent Standard Notes editor plugin may share byte-equivalent AIC Editor Core files;
  sharing presentation logic does not create an account or data connection.
- One universal VSIX supports Windows, Linux, macOS, and code-server without platform binaries.
- Opening a Markdown language buffer activates the extension so native-editor slash templates do
  not depend on first opening the Notes view or an AIC custom editor.
- Upgrade cleanup removes only retired local session material, binding metadata, and the
  exact former authentication SecretStorage key. It never deletes Markdown or contacts a remote service.

## State contracts

- Save, Ctrl/Cmd+S, leaving the editing surface and security preview mutation actions are
  shared persistence boundaries. Ordinary input does not save. An ACK is required for saved state.
- Dirty drafts remain in the webview until local save succeeds. A failed or stale save leaves the
  draft dirty and visible.
- Saved notes are neutral, dirty drafts softly amber with a non-color change marker, and
  placeholders gray. The duplicate name/folder/save-status header is absent; local state remains
  accessible through the live status without repeating it visually.
- The active custom-editor tab is authoritative over a stale native editor. With no active file
  buffer, the last relevant workspace project note is used, then the first workspace.
- Pinning affects only automatic following. Explicit file/folder/project/note navigation can
  always select the requested context.
- Navigation is serialized. A slower open/stat operation cannot replace a later user selection,
  and one rejected navigation request cannot poison the queue.
- A missing sidecar is a lazy placeholder. Unchanged scaffolding does not create a file.
- Explorer `.note.md` clicks open only the main note editor; Open Source is a distinct action.
  The legacy `aicNotes.noteRedirect` association is a main-editor alias, not a disposable redirect.
- An active main `.note.md` follows its nearest existing parent folder note in the unpinned sidebar,
  falling back to the owning workspace project note/placeholder. The source need not exist. Pin,
  unsaved drafts and current-tab identity remain authoritative across IO; unchanged parents are
  not reinitialized. Note creation/deletion recomputes context without writing any notes.
- Saves persist only the authored Markdown. Legacy YAML Properties and historical
  generated keys remain exact raw text; the extension does not interpret, stamp,
  remove, or migrate them. Secondary headers do not display file dates.
- Context relationships are derived dynamically and displayed only below existing note
  frontmatter. Only actual notes add ancestor folders; project/current navigation can show a
  placeholder. Each row opens the exact `.note.md` target. They are never serialized or edited.
- Trash is local, confirmed, and routed through the operating-system Trash where supported.

## Surfaces

| Surface                    | Owner                                           | Persistent side effect                                         | Failure behavior                                                     |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| AIC Markdown custom editor | `src/editor/provider.js`, `src/webview/main.js` | explicit VS Code document save                                 | stale generations reset or retain the visible draft                  |
| Linked Note Secondary pane | `src/secondary/provider.js`                     | explicit local sidecar write/save or local Trash               | never replaces an unsaved draft; reports a compact local error       |
| Selection-to-note command  | `src/notes/selection.js`                        | inserts into the live local sidebar draft; no implicit save    | rejects unsaved/unbacked/out-of-workspace sources                    |
| Structured previews        | `vendor/markdown`, `vendor/aic-editor-core`     | exact Markdown transactions only                               | invalid source remains editable instead of being normalized silently |
| Slash template completion  | shared core plus `src/editor/slash-provider.js` | inserts exact Markdown in AIC, native, and contextual Markdown | inactive in code/read-only contexts                                  |
| AIC agent workflow         | `src/agents/bootstrap.js`                       | explicit thin marker, then trusted AIC-owned rule status/sync  | no CLI on untrusted or unmarked automatic activation                 |

## Commands

| Command                          | Contract                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `aicNotes.noteForCurrentFile`    | Follow a lazy sidecar for the active local source, or open a note's source; without an active file, report what to focus |
| `aicNotes.linkSelectionToNote`   | Copy selected source into one deduplicated linked-comment block and focus its comment caret                              |
| `aicNotes.openInSecondary`       | Route an existing sidecar or placeholder to the Secondary pane                                                           |
| `aicNotes.noteForExplorerItem`   | Follow a file or folder selected in Explorer, using the same lazy placeholder rule                                       |
| `aicNotes.openProjectNote`       | Show the selected/current workspace root note or its placeholder                                                         |
| `aicNotes.enableExplorerNesting` | Add workspace Explorer nesting patterns for sidecars                                                                     |
| `aicNotes.openSource`            | Explicitly open the file owner with its sidebar note, or reveal the folder/project owner; reject ambiguous sources       |
| `aicNotes.useNativeForMarkdown`  | Set the user association for plain `*.md` back to the native editor while keeping notes in the AIC main editor           |
| `aicNotes.enableAgentWorkflow`   | Write the thin workspace marker and validate AIC-owned rule status                                                       |
| `aicNotes.syncAgentInstructions` | Explicitly verify/update the installed AIC agent-rule contract; this is unrelated to note files or Standard Notes        |

## Preview interaction contracts

- Native preview text selection remains stable for copying. CodeMirror selections disclose
  intersected source, while `Ctrl/Cmd+A` discloses the complete Markdown document.
- Every replaced preview publishes its exact source range as an atomic CodeMirror navigation unit.
  Edit pins one source block while its cursor or selection remains inside, including fence edges.
- Link main-click opens; Open, Copy, and Edit icon controls remain visible.
- Code fences expose Copy and Edit controls.
- Mermaid exposes Copy, Edit, zoom, fit, focusable two-dimensional scroll, and 90° rotation.
- The shared flowchart/class/sequence visual builder remains accessible above active Mermaid
  source, including selected slash-snippet fields. Unsupported grammar remains exact source.
- Tables expose Copy, insertion, drag reorder, content-sized word-wrapped columns, horizontal scroll,
  and one transient popover editor for the selected cell.
- One bounded fenced `aic` document owns structured fields and the shared widget
  lifecycle. Every value begins with `|`, `*|`, `#|`, or `_|` for text, secret,
  TOTP, or card data; `1|`/`0|` are unused/used one-time values. Types can differ
  within one field. Legacy YAML Properties
  stay raw and editable without automatic conversion.
- Details accordions preserve comments, task-checkbox interaction, collapsed/open state, and links.
- Action glyphs are CSS SVG masks; no renderer must accept inline SVG button markup.
- Slash on an otherwise empty Markdown line opens the shared contextual template catalog in AIC
  Markdown, native/untitled VS Code Markdown, and contextual notes. Empty
  notes rank complete pages first, existing pages rank page sections first, and `Tab` advances
  through inserted perspective questions. Seven labeled groups organize complete pages, structure,
  assurance, references, data, diagrams, and content. The same core is mounted in ordinary `.md`
  documents and contextual `.note.md` notes. Code and read-only contexts never activate it.
- `/list`, `/list-numbered` and `/table` are primitive blocks, without mandatory page metadata or
  headings. Specialized tables/checklists and the existing `/class-diagram` remain distinct.

## Paired-editor boundary

- AIC Notes and AIC for Standard Notes consume byte-identical core modules for drafts,
  structured AIC fields, structured mutations, atomic preview ranges, code-fence cards/extensions, slash
  templates, icons, and Mermaid viewport state.
  Legacy YAML Properties are outside the active renderer; shared extensions use the
  CodeMirror public APIs already pinned identically by both products. Each host keeps only persistence, clipboard,
  selection, and theme wiring.
- Markdown editor interactions in this section are the shared product contract. A release cannot
  replace a preview action with raw-source fallback in only one product.
- Workspace navigation, sidecars, project context, Explorer trees, local Trash, and selection
  comments are VS Code host capabilities. They are deliberately absent from Standard Notes, just
  as Standard Notes UUID/lock/component lifecycle behavior is absent from VS Code.

## Verification ownership

- Pure behavior: `test/*.test.js`; retired sphere modules are excluded from the release.
- Host navigation, parent selection, draft/save races and edit leases:
  `test/note-routing.test.js`, `test/note-transition-races.test.js`,
  `test/edit-ownership.test.js`.
- Exact-key retired-auth cleanup and trusted agent bootstrap:
  `test/retired-auth-cleanup.test.js`, `test/agent-bootstrap.test.js`.
- Manifest, UI wiring, local-only boundary, upgrade cleanup, and packaging contract:
  `test/release-contract.test.js`.
- Command registration/index completeness: `test/function-index.test.js`.
- Bundle construction: `esbuild.mjs`.
- Universal archive/checksum/secret scan: `scripts/verify-release.mjs`.
- Tag build and GitHub asset publication: `.github/workflows/release.yml`.
- These are automated and bounded checks, not proof of exhaustive memory/context recall,
  all remote providers or all desktop platforms.
