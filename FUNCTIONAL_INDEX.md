# Functional index

This index is the release contract for AIC Notes 29.1.0. Every public command, state boundary,
side effect, failure rule, and platform assumption is represented here and checked by tests or the
release archive verifier.

## Shared editor core 3.4.0

These contracts ship with AIC Notes 29.1.0 and pair with Standard Notes AIC 21.3.5.
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

The AIC Markdown editor shares heading/list formatting commands with the Standard Notes
component: Ctrl/Cmd+Alt+1…6 (headings), Ctrl/Cmd+Alt+0 (paragraph),
Ctrl/Cmd+Shift+7/8/9 (numbered/bullet/checkbox lists). These shortcuts apply to both
`.md` and `.note.md` in AIC surfaces, not the native VS Code source editor. The shared
slash catalog supplies `/checklist` there as well, searchable by checkbox/tasklist.
Formatting is one local edit, never a save, and protects code/frontmatter/structured blocks.

- The extension reads and writes only local workspace `*.md` and `*.note.md` files.
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
- Generated sidecar frontmatter contains exactly `file`, `created`, and `updated`; `updated` is
  refreshed only at explicit save. Ordinary Markdown receives no generated properties.
- Context relationships are derived dynamically and displayed only below existing note
  frontmatter. Only actual notes add ancestor folders; project/current navigation can show a
  placeholder. Each row opens the exact `.note.md` target. They are never serialized or edited.
- Trash is local, confirmed, and routed through the operating-system Trash where supported.

## Surfaces

| Surface                    | Owner                                           | Persistent side effect                                             | Failure behavior                                                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| AIC Markdown custom editor | `src/editor/provider.js`, `src/webview/main.js` | explicit VS Code document save                                     | stale generations reset or retain the visible draft                  |
| Linked Note Secondary pane | `src/secondary/provider.js`                     | explicit local sidecar write/save or local Trash                   | never replaces an unsaved draft; reports a compact local error       |
| Notes & Documents tree     | `src/notes/tree.js`                             | none                                                               | refreshes from workspace files and lazy project placeholders         |
| Selection-to-note command  | `src/notes/selection.js`                        | saves source, updates one local sidecar on its later explicit save | rejects unsaved/unbacked/out-of-workspace sources                    |
| Structured previews        | `vendor/markdown`, `vendor/aic-editor-core`     | exact Markdown transactions only                                   | invalid source remains editable instead of being normalized silently |
| Slash template completion  | shared core plus `src/editor/slash-provider.js` | inserts exact Markdown in AIC, native, and contextual Markdown     | inactive in code/read-only contexts                                  |
| AIC agent workflow         | `src/agents/bootstrap.js`                       | thin marker and explicit AIC-owned rule update                     | typed command errors; unrelated editor use remains available         |

## Commands

| Command                          | Contract                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `aicNotes.standardNotesAccount` | Visible account menu; never exposes tokens to editor webviews |
| `aicNotes.signInStandardNotes` | Trusted-workspace password/TOTP login; derived server password only; verified session must persist securely |
| `aicNotes.checkStandardNotesConnection` | Verify/refresh saved authentication only; preserve secrets offline; never access note items |
| `aicNotes.signOutStandardNotes` | Delete local secret and revoke only this session; warn if remote revocation is unconfirmed |
| `aicNotes.noteForCurrentFile`    | Follow or create a lazy linked note for the active local file; global keybinding works with no active file by showing the project note |
| `aicNotes.linkSelectionToNote`   | Copy selected source into one deduplicated linked-comment block and focus its comment caret                                            |
| `aicNotes.openInSecondary`       | Route an existing sidecar or placeholder to the Secondary pane                                                                         |
| `aicNotes.noteForExplorerItem`   | Follow a file or folder selected in Explorer, using the same lazy placeholder rule                                                     |
| `aicNotes.openProjectNote`       | Show the selected/current workspace root note or its placeholder                                                                       |
| `aicNotes.refreshTree`           | Re-index local Markdown and note files                                                                                                 |
| `aicNotes.enableExplorerNesting` | Add workspace Explorer nesting patterns for sidecars                                                                                   |
| `aicNotes.openSource`            | Explicitly open the file owner with its sidebar note, or reveal the folder/project owner; reject ambiguous sources                     |
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

- Pure behavior: `test/*.test.js`.
- Manifest, UI wiring, local-only boundary, upgrade cleanup, and packaging contract:
  `test/release-contract.test.js`.
- Command registration/index completeness: `test/function-index.test.js`.
- Bundle construction: `esbuild.mjs`.
- Universal archive/checksum/secret scan: `scripts/verify-release.mjs`.
- Tag build and GitHub asset publication: `.github/workflows/release.yml`.
