# Functional index

This index is the release contract for AIC Notes 25.0.2. Every public command, state boundary,
side effect, failure rule, and platform assumption is represented here and checked by tests or the
release archive verifier.

## Product boundary

- The extension reads and writes only local workspace `*.md` and `*.note.md` files.
- There is no Standard Notes authorization, API client, import, synchronization, remote identity,
  tag graph, conflict resolver, remote Trash action, native helper, or WebAssembly helper.
- The independent Standard Notes editor plugin may share byte-equivalent AIC Editor Core files;
  sharing presentation logic does not create an account or data connection.
- One universal VSIX supports Windows, Linux, macOS, and code-server without platform binaries.
- Upgrade cleanup removes only retired local session material and binding metadata. It never
  deletes Markdown or contacts a remote service.

## State contracts

- `Ctrl/Cmd+S` is the only Secondary note persistence boundary. Input and blur do not save.
- Dirty drafts remain in the webview until local save succeeds. A failed or stale save leaves the
  draft dirty and visible.
- Saved, unsaved, and placeholder states are visually distinct; the status text contains only
  local state.
- The active custom-editor tab is authoritative over a stale native editor. With no active file
  buffer, the last relevant workspace project note is used, then the first workspace.
- Pinning affects only automatic following. Explicit file/folder/project/note navigation can
  always select the requested context.
- Navigation is serialized. A slower open/stat operation cannot replace a later user selection,
  and one rejected navigation request cannot poison the queue.
- A missing sidecar is a lazy placeholder. Unchanged scaffolding does not create a file.
- Generated sidecar frontmatter contains exactly `file`, `created`, and `updated`; `updated` is
  refreshed only at explicit save. Ordinary Markdown receives no generated properties.
- Context relationships are derived dynamically and displayed only below existing note
  frontmatter. They are never serialized or edited.
- Trash is local, confirmed, and routed through the operating-system Trash where supported.

## Surfaces

| Surface                    | Owner                                           | Persistent side effect                                             | Failure behavior                                                     |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| AIC Markdown custom editor | `src/editor/provider.js`, `src/webview/main.js` | explicit VS Code document save                                     | stale generations reset or retain the visible draft                  |
| Linked Note Secondary pane | `src/secondary/provider.js`                     | explicit local sidecar write/save or local Trash                   | never replaces an unsaved draft; reports a compact local error       |
| Notes & Documents tree     | `src/notes/tree.js`                             | none                                                               | refreshes from workspace files and lazy project placeholders         |
| Selection-to-note command  | `src/notes/selection.js`                        | saves source, updates one local sidecar on its later explicit save | rejects unsaved/unbacked/out-of-workspace sources                    |
| Structured previews        | `vendor/markdown`, `vendor/aic-editor-core`     | exact Markdown transactions only                                   | invalid source remains editable instead of being normalized silently |
| AIC agent workflow         | `src/agents/bootstrap.js`                       | thin marker and explicit AIC-owned rule update                     | typed command errors; unrelated editor use remains available         |

## Commands

| Command                          | Contract                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `aicNotes.noteForCurrentFile`    | Follow or create a lazy linked note for the active local file; global keybinding works with no active file by showing the project note |
| `aicNotes.linkSelectionToNote`   | Copy selected source into one deduplicated linked-comment block and focus its comment caret                                            |
| `aicNotes.openInSecondary`       | Route an existing sidecar or placeholder to the Secondary pane                                                                         |
| `aicNotes.noteForExplorerItem`   | Follow a file or folder selected in Explorer, using the same lazy placeholder rule                                                     |
| `aicNotes.openProjectNote`       | Show the selected/current workspace root note or its placeholder                                                                       |
| `aicNotes.refreshTree`           | Re-index local Markdown and note files                                                                                                 |
| `aicNotes.enableExplorerNesting` | Add workspace Explorer nesting patterns for sidecars                                                                                   |
| `aicNotes.openTarget`            | Open the file owner or reveal the folder/project owner of a note                                                                       |
| `aicNotes.copyWikiLink`          | Copy the local note's wiki-link path                                                                                                   |
| `aicNotes.openNote`              | Open a tree note through the Secondary routing path                                                                                    |
| `aicNotes.useNativeForMarkdown`  | Set the user association for plain `*.md` back to the native editor while preserving the note redirect                                 |
| `aicNotes.deleteNote`            | Confirm and move one local sidecar to Trash                                                                                            |
| `aicNotes.deleteFolderNotes`     | Confirm and move the indexed local sidecars under one tree node to Trash                                                               |
| `aicNotes.enableAgentWorkflow`   | Write the thin workspace marker and validate AIC-owned rule status                                                                     |
| `aicNotes.syncAgentInstructions` | Explicitly verify/update the installed AIC agent-rule contract; this is unrelated to note files or Standard Notes                      |

## Preview interaction contracts

- Native preview text selection remains stable for copying. CodeMirror selections disclose
  intersected source, while `Ctrl/Cmd+A` discloses the complete Markdown document.
- Link main-click opens; Open, Copy, and Edit icon controls remain visible.
- Code fences expose Copy and Edit controls.
- Mermaid exposes Copy, Edit, zoom, fit, focusable two-dimensional scroll, and 90° rotation.
- Tables expose Copy, insertion, drag reorder, content-sized word-wrapped columns, horizontal scroll,
  and one transient popover editor for the selected cell.
- Note properties expose insertion, hierarchy-preserving reorder, nested YAML, and one transient
  popover editor. Plain Markdown has no generated property card.
- Details accordions preserve comments, task-checkbox interaction, collapsed/open state, and links.
- Action glyphs are CSS SVG masks; no renderer must accept inline SVG button markup.

## Paired-editor boundary

- AIC Notes and AIC for Standard Notes consume byte-identical core modules for drafts, managed
  properties, structured mutations, code-fence cards/extensions, icons, and Mermaid viewport state.
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
