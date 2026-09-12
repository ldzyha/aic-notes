# Functional index

This index records the coordinated AIC Notes 35.0.1 / Standard Notes AIC 26.0.1 /
shared editor core 3.7.1 release target. Public commands, state boundaries, side effects and
failure rules are checked by tests and the release archive verifier; this is not a claim of
exhaustive runtime coverage or that publication has already completed.

## Authenticator JSON conversion

Shared `security-import` owns the bounded, lossless, all-or-nothing JSON-to-security mapping;
`security-import-extension` owns the contextual panel and atomic editor transaction in both
main and sidebar. Each record becomes a separate block. Secret/password and extra string
fields are masked; duplicate keys and unrepresentable values never silently disappear.
Conversion acts only on the current document/selection, never the account or clipboard, and
does not save automatically. Tests: `security-import`, canonical import model/UI suites and
production webview browser checks. Artifact publication is verified separately from source tests.

## Current release contracts

- Shared `security-password` provides bounded WebCrypto-only unbiased generation (default24,
  length8–128, every enabled group represented). Only empty recognized hidden password fields
  can generate; existing values/TOTP/API keys are excluded.
- Field label/value tap copies only its value with per-field acknowledged feedback; Tab
  navigates. Paste directly reads current text and is disabled on all populated fields;
  no Replace, history picker or visible panel on success. Empty reads cannot erase.
  Source Edit is the sole manual value editor. Main/sidebar use an identity-bound native
  clipboard manager with no polling, history storage, secret diagnostics or automatic save.
  Both hosts offer inline masked paste-only capture only after clipboard access fails.

- Shared `aic-security` blocks have one canonical model. `##` headings define
  independent sections; `Label*: value` masks a field, `Label: value` keeps it
  visible. Edit opens raw Markdown. Explicit Copy block and field actions,
  safe HTTP(S) Open, Add section, quick fields and New block work without an
  inline form or implicit save. TOTP derives a current code from a key. Ordinary
  code preview skips these fences. Raw Markdown and copied blocks still expose
  plaintext; VS Code has no note synchronization or QR import UI.

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
- The dedicated File Context sphere is connected to the extension. It remains a visible region
  above Linked Note when enabled (default), including an empty state; its toggle hides/shows it
  independently of note navigation. A bounded read-only graph uses open, changed, dirty and pinned
  workspace files; existing note sidecars; and statically resolved relative JS/TS imports. It is
  not a function/attribute/LSP dependency graph, workspace crawler or note writer.

Standard Notes authentication is implemented but auth-only; no note synchronization exists.
The contracts below describe this coordinated release target, not future sync behavior.

## Shared editor core 3.7.1

These contracts target AIC Notes 35.0.1 and pair with Standard Notes AIC 26.0.1.
The exact canonical commit and all shared hashes are recorded in CORE_SNAPSHOT.json.
Automated tests, production builds and Windows browser checks cover the shared editor;
Linux desktop and live authenticated Standard Notes smoke checks are not implied.

| Area / owner                                                | Implemented contract                                                                                                                                          | Explicit limitation                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Shared templates and native completion                      | Core questions → answers → detail; `/noise`, `/wave`, `/implementation`, `/context`, `/entity-map`; contextual heading levels in `.md` and `.note.md`         | No automatic wave/noise state, dashboards or grouping UI                                                              |
| New-note bodies (`note-template`, `src/notes/templates.js`) | Shared Noise guidance evolves through `/wave` in the same note; custom overrides and three managed properties retain their contract                           | Existing notes are not rewritten; Standard Notes does not receive VS Code workspace templates                         |
| Shared diagram model/builder                                | Actual Mermaid SVG provides palette insertion, connection dragging, typed relationships, property editing, draft Copy, Undo/Redo/deletion and zoom/scroll/fit | Bounded flow/class/sequence grammar; no multiselect, subgraph authoring, visual timeline or arbitrary Mermaid support |
| Shared diagram session                                      | Inline Apply changes only the current block; outside edits preserve the draft; conflicting block edits/read-only retain a Copy-only draft; Ctrl/Cmd+S saves   | Cancel explicitly discards the draft; note identity changes retire the session; no cross-scale links                  |
| Layout and ordering                                         | Inline editing and read preview use the same Mermaid auto-layout; direction and sequence ordering are source semantics                                        | No arbitrary stored coordinates; legacy coordinates are ignored, and removed only after an actual visual edit         |

Usage: insert a diagram through `/`, choose **Edit diagram visually** on its AIC preview, edit and
Apply, then Ctrl/Cmd+S. Ctrl/Cmd+S within the builder combines Apply with the existing explicit save.
The native Markdown editor shares templates but remains a source editor. `/entity-map` describes
composition; `/timeline` stays chronological. Shared preview-spacing and session-lifecycle fixes
are implemented; completed cross-platform/live-client smoke testing is not implied.

## Product boundary

Authentication responses use bounded UTF-8 decoding and validated cookie pairs, including
Electron-folded headers. Error messages expose only allowlisted stage/reason labels and HTTP
status. Synthetic regressions cover BOM, cookies, challenges and secret-free account diagnostics;
they are not a real-account sign-in result.

The AIC Markdown editor shares heading/list formatting commands with the Standard Notes
component: Ctrl/Cmd+Alt+1…6 (headings), Ctrl/Cmd+Alt+0 (paragraph),
Ctrl/Cmd+Shift+7/8/9 (numbered/bullet/checkbox lists). These shortcuts apply to both
`.md` and `.note.md` in AIC surfaces, not the native VS Code source editor. The shared
slash catalog supplies `/checklist` there as well, searchable by checkbox/tasklist.
Formatting is one local edit, never a save, and protects code/frontmatter/structured blocks.

- The note editor persists only local workspace `*.md` and `*.note.md` files. The read-only
  File Context sphere may inspect bounded JS/TS source and workspace/Git metadata. The optional
  trusted agent workflow may write its thin workspace marker and run AIC-owned global rule sync;
  neither path is note synchronization.
- Standard Notes authorization is optional and auth-only. The host has a fixed-origin auth
  endpoint allowlist, native password/TOTP prompts, protocol-004 derivation and SecretStorage.
  Connected requires authenticated verification and persisted secrets; Offline is distinct.
  No import, note synchronization, tag graph, conflict resolver, remote note Trash action,
  native helper or WebAssembly helper exists. Saved notes remain local.
- The independent Standard Notes editor plugin may share byte-equivalent AIC Editor Core files;
  sharing presentation logic does not create an account or data connection.
- One universal VSIX supports Windows, Linux, macOS, and code-server without platform binaries.
- Opening a Markdown language buffer activates the extension so native-editor slash templates do
  not depend on first opening the Notes view or an AIC custom editor.
- Upgrade cleanup removes only retired local session material and binding metadata. It never
  deletes Markdown or contacts a remote service.

## State contracts

- `Ctrl/Cmd+S` is the only Secondary note persistence boundary. Input and blur do not save.
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
- Generated sidecar frontmatter contains exactly `file`, `created`, and `updated`; `updated` is
  refreshed only at explicit save. Ordinary Markdown receives no generated properties; existing
  authored frontmatter is preserved. There is no reliable origin marker for historical keys, so
  the extension does not automatically remove or rewrite ordinary `.md` frontmatter.
- Context relationships are derived dynamically and displayed only below existing note
  frontmatter. Only actual notes add ancestor folders; project/current navigation can show a
  placeholder. Each row opens the exact `.note.md` target. They are never serialized or edited.
- Trash is local, confirmed, and routed through the operating-system Trash where supported.
- The File Context sphere is an always-present region while enabled; pinning a node changes only
  its graph membership, not note-pane pin/follow state. Status or text edits do not rotate the
  layout. Import analysis is static, bounded to 80 nodes/256 KiB source files and relative JS/TS
  imports; unresolved/dynamic/non-relative edges are reported as partial or unavailable. The
  graph never runs project code, LSP, note creation or filesystem writes.

## Surfaces

| Surface                    | Owner                                           | Persistent side effect                                             | Failure behavior                                                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| AIC Markdown custom editor | `src/editor/provider.js`, `src/webview/main.js` | explicit VS Code document save                                     | stale generations reset or retain the visible draft                  |
| Linked Note Secondary pane | `src/secondary/provider.js`                     | explicit local sidecar write/save or local Trash                   | never replaces an unsaved draft; reports a compact local error       |
| File Context sphere        | `src/context/sphere-provider.js`, `src/context/sphere-graph.js`, `src/webview/sphere.js`, shared `context-sphere` | pinned node IDs in workspace state only | bounded read-only graph; unknown/stale IDs cannot open files |
| Notes & Documents tree     | `src/notes/tree.js`                             | none                                                               | refreshes from workspace files and lazy project placeholders         |
| Selection-to-note command  | `src/notes/selection.js`                        | inserts into the live local sidebar draft; no implicit save       | rejects unsaved/unbacked/out-of-workspace sources                    |
| Structured previews        | `vendor/markdown`, `vendor/aic-editor-core`     | exact Markdown transactions only                                   | invalid source remains editable instead of being normalized silently |
| Slash template completion  | shared core plus `src/editor/slash-provider.js` | inserts exact Markdown in AIC, native, and contextual Markdown     | inactive in code/read-only contexts                                  |
| AIC agent workflow         | `src/agents/bootstrap.js`                       | explicit thin marker, then trusted AIC-owned rule status/sync       | no CLI on untrusted or unmarked automatic activation                  |

## Commands

| Command                          | Contract                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `aicNotes.toggleContextSphere` | Independently hide/show the File Context sphere; default enabled, without changing the Linked Note pane |
| `aicNotes.standardNotesAccount` | Visible account menu; never exposes tokens to editor webviews |
| `aicNotes.signInStandardNotes` | Trusted-workspace password/TOTP login; derived server password only; verified session must persist securely |
| `aicNotes.checkStandardNotesConnection` | Verify/refresh saved authentication only; preserve secrets offline; never access note items |
| `aicNotes.signOutStandardNotes` | Delete local secret and revoke only this session; warn if remote revocation is unconfirmed |
| `aicNotes.noteForCurrentFile`    | Follow a lazy sidecar for the active local source, or open a note's source; without an active file, report what to focus |
| `aicNotes.linkSelectionToNote`   | Copy selected source into one deduplicated linked-comment block and focus its comment caret                                            |
| `aicNotes.openInSecondary`       | Route an existing sidecar or placeholder to the Secondary pane                                                                         |
| `aicNotes.noteForExplorerItem`   | Follow a file or folder selected in Explorer, using the same lazy placeholder rule                                                     |
| `aicNotes.openProjectNote`       | Show the selected/current workspace root note or its placeholder                                                                       |
| `aicNotes.refreshTree`           | Re-index local Markdown and note files                                                                                                 |
| `aicNotes.enableExplorerNesting` | Add workspace Explorer nesting patterns for sidecars                                                                                   |
| `aicNotes.openSource`            | Explicitly open the file owner with its sidebar note, or reveal the folder/project owner; reject ambiguous sources                     |
| `aicNotes.openTarget`            | Open the selected tree note's verified source target through the same explicit source route                                            |
| `aicNotes.copyWikiLink`          | Copy the local note's wiki-link path                                                                                                   |
| `aicNotes.openNote`              | Open an existing tree note in the main AIC Markdown editor                                                                             |
| `aicNotes.useNativeForMarkdown`  | Set the user association for plain `*.md` back to the native editor while keeping notes in the AIC main editor                         |
| `aicNotes.deleteNote`            | Confirm and move one local sidecar to Trash                                                                                            |
| `aicNotes.deleteFolderNotes`     | Confirm and move the indexed local sidecars under one tree node to Trash                                                               |
| `aicNotes.enableAgentWorkflow`   | Write the thin workspace marker and validate AIC-owned rule status                                                                     |
| `aicNotes.syncAgentInstructions` | Explicitly verify/update the installed AIC agent-rule contract; this is unrelated to note files or Standard Notes                      |

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
- Note properties expose insertion, hierarchy-preserving reorder, nested YAML, and one transient
  popover editor. Plain Markdown has no generated property card.
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

- AIC Notes and AIC for Standard Notes consume byte-identical core modules for drafts, managed
  properties, structured mutations, atomic preview ranges, code-fence cards/extensions, slash
  templates, icons, and Mermaid viewport state.
  The foundations remain dependency-free; the shared fence extension uses the CodeMirror public
  APIs already pinned identically by both products. Each host keeps only persistence, clipboard,
  selection, and theme wiring.
- Markdown editor interactions in this section are the shared product contract. A release cannot
  replace a preview action with raw-source fallback in only one product.
- Workspace navigation, sidecars, project context, Explorer trees, local Trash, and selection
  comments are VS Code host capabilities. They are deliberately absent from Standard Notes, just
  as Standard Notes UUID/lock/component lifecycle behavior is absent from VS Code.

## Verification ownership

- Pure behavior: `test/*.test.js`; static graph bounds/import analysis in
  `test/context-sphere-graph.test.js` and shared sphere layout tests.
- Host navigation, parent selection, draft/save races and edit leases:
  `test/note-routing.test.js`, `test/note-transition-races.test.js`,
  `test/edit-ownership.test.js`; sphere capability/lifecycle checks in
  `test/context-sphere-provider.test.js`.
- Auth transport, SecretStorage, cross-window lock and trusted agent bootstrap:
  `test/standard-notes-*.test.js`, `test/agent-bootstrap.test.js`.
- Manifest, UI wiring, local-only boundary, upgrade cleanup, and packaging contract:
  `test/release-contract.test.js`.
- Command registration/index completeness: `test/function-index.test.js`.
- Bundle construction: `esbuild.mjs`.
- Universal archive/checksum/secret scan: `scripts/verify-release.mjs`.
- Tag build and GitHub asset publication: `.github/workflows/release.yml`.
- These are automated and bounded checks, not proof of exhaustive memory/context recall,
  live Standard Notes account access, all remote providers, or all desktop platforms.
