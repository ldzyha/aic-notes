# AIC Notes

AIC Notes is a local Markdown editor for VS Code/Code. It edits every `*.md` document with the AIC
preview-first surface, including `*.note.md`, and shows linked notes in the Secondary Side Bar.
Optional Standard Notes sign-in is available. There is no note synchronization, import, polling,
upload, remote deletion or remote conflict state.

The independent [AIC for Standard Notes](https://github.com/ldzyha/standard-notes-aic) plugin shares
the editor-core contract, but it is a separate product. Signing in does not move notes between
the two applications. The plugin remains 21.3.5; this host-only release needs no plugin update.

## Release 30.0.1 — Standard Notes authentication response fix

This auth-only hotfix accepts leading-BOM JSON and correctly reads auth cookies when VS Code's
Electron networking combines headers. Rate limits and verification challenges remain actionable
even if an intermediary returns HTML. A rejected response now includes a fixed stage/reason code
in the account tooltip and warning; this code never contains credentials or raw server data.
Unfinished refactoring, parent routing, context-sphere work and note synchronization are excluded.

After installation, save drafts and run **Developer: Reload Window**. Open an AIC Notes view,
a Markdown file, or the command below to activate the extension.

1. Click **SN: Sign in** in the status bar, the account icon on the Notes panel, or run
   **AIC Notes: Sign In to Standard Notes** from the Command Palette.
2. In a trusted workspace, enter your email and password in native VS Code prompts, then a
   six-digit authenticator code if requested. Never paste a password into a note or settings.
3. **SN: Connected** appears only after the session passes an authenticated server check and
   is written to VS Code SecretStorage. The account menu offers **Check connection** and **Sign out**.
4. On restart, the saved session is checked again. Offline is distinct from Connected; an absent
   account is quiet. Sign-out removes the local secret and attempts to revoke that session only.
   If server revocation cannot be confirmed, the action explicitly warns you.

The host supports `https://api.standardnotes.com`, protocol 004, password and TOTP sign-in.
Security-key and human-verification challenges fail with an explicit unsupported message;
self-hosted servers and older encryption protocols are not supported in this release.
Working SecretStorage is required; there is no plaintext, file or settings fallback.
The password is derived locally with Argon2id; only its derived server-password half is submitted.
Tokens and the local master key stay in SecretStorage, never in editor webviews or note files.
VS Code windows sharing extension storage observe secret changes. Auth mutations take a
JavaScript-only inter-window lease; a busy window reports the conflict without deleting or
overwriting the session. Its empty heartbeat directory in extension storage contains no secrets.
This is not a distributed editing lock or note-sync system.

Tests include the official production-cost key-derivation vector and mocked login, MFA, refresh,
storage, cancellation and logout paths. These do not replace a real-account smoke test: enter
your credentials directly in VS Code and verify Connected after reloading. No user account or
note content was accessed to build this release. The unfinished context sphere is not bundled.

## Retained editor features — shared editor core 3.4.0

This release pairs with AIC for Standard Notes 21.3.5. Both products use the same
byte-verified core. Automated tests, production builds and Windows browser checks cover the
shared controls; Linux desktop and live authenticated Standard Notes smoke checks are not implied.

- `/page`, `/section`, `/context` and `/implementation` follow Core's question → answer → detail
  structure, with dependency-ordered steps and verification where needed. There are no compulsory
  Purpose/Proposal sections. The same catalog works in AIC and native Markdown, including `.note.md`.
- `/list`, `/list-numbered`, `/checklist` and `/table` insert an unordered list, ordered list,
  bare checkbox list and simple table. `/checkbox` and `/tasklist` also find `/checklist`;
  `/tasks` remains the separate verification section.
- Explorer note clicks open just the note in the main editor. **Open Source** is a separate
  action that opens the source with its linked sidebar note; folder/project sources are revealed.
  Persisted legacy note associations resolve to the main editor without changing user settings.
- The note pane starts directly at its content/properties, without a duplicate name, folder or
  save-status header. Saved notes are neutral; unsaved notes have a soft amber tint and a small
  change marker; placeholders are gray. Save remains explicit Ctrl/Cmd+S.
- Context ancestors require existing `.note.md` notes. Project navigation always remains,
  opening its note or placeholder; the actual current target can also be a placeholder.
- In the AIC editor, Mermaid source now retains its visual-editor button above the fence while
  the caret or a snippet field is inside it. Raw Markdown remains editable. `/class` finds
  `/class-diagram`; native VS Code text editors offer snippets but not the embedded canvas.
- `/noise` captures uncertainty; `/wave` develops a result and executable path in the same note.
  New default file/folder/project notes start with compact Noise guidance. Existing notes and
  accepted `.aic/templates/*.md` overrides are preserved; generated note properties remain exactly
  `file`, `created` and `updated`. There is no automatic noise/wave classification or grouping UI.
- Insert `/flowchart`, `/class-diagram`, `/sequence` or `/entity-map` in AIC Markdown, then choose
  **Edit diagram visually** on its Mermaid preview. Controls open inside that same block, not in
  a dialog. Drag an element from the semantic palette onto the preview (or click its button),
  select a node to rename/change/delete it in the compact
  context bar, and drag a connection handle onto another node to create a solid arrow. Click a
  line to edit its label/type/direction. Mermaid computes the actual layout from the source and
  direction; palette drop positions are not saved as coordinates. Sequence order remains semantic.
  Undo/Redo, deletion, zoom, scroll and fit are available. The native source editor still edits Markdown;
  the visual builder belongs to the AIC preview surface.
- Diagram controls remain compact independently of the document's font size. The selected
  element has one short bar; endpoints, entity members and related connections open on demand.
  Palette and selectors share semantic labels: State/Event/Condition, Entity, Participant/Actor.
  The entity-map profile uses Entity and Association/Dependency; geometry names stay internal.
- **Apply diagram changes** updates the block; **Ctrl/Cmd+S** saves the document. Ctrl/Cmd+S inside
  the builder applies and requests the same explicit save. Cancel discards the builder draft.
  Changes outside the block preserve it; conflicting block edits disable Apply and retain a
  copyable draft. Switching notes retires the old session. No input/blur autosave is added.
- The shared builder supports a bounded flow/class/sequence grammar. Unsupported Mermaid remains
  in source mode with the original intact. Read preview and inline editing use the same renderer
  and layout configuration. Legacy `%% aic-builder-layout` coordinates do not control layout and
  are removed only when a supported visual edit rewrites the block; opening or unchanged Apply
  does not rewrite source.
- Enter preserves indentation and list continuation; Tab/Shift+Tab indent/outdent unless a
  snippet field is active. The Mermaid source textarea shares indentation behavior; Escape then
  Tab leaves that field, while Escape twice closes inline editing.
- In AIC Markdown (documents and notes), Ctrl/Cmd+Alt+1…6 toggles heading levels;
  Ctrl/Cmd+Shift+7/8/9 toggles numbered, bullet and checkbox lists. Formatting does not save.
- Agentic Notes has a tested shared scope/section core, not an active universal agent adapter.
  It selects existing current/ancestor notes, excludes sibling memory and private notes, and
  proposes edits confined to a marked Agentic Notes section. A live-document write bridge and
  cross-client integration are still required; no standalone disk writer is enabled.

Entity-map composition is separate from the chronological, source-edited `/timeline`. Automatic
drill-down/cross-scale links, multiselect, subgraph authoring and full arbitrary Mermaid support are
**not implemented**. Shared popup/session and preview-navigation stability changes are included;
this section does not assert that all clients or operating systems have completed final smoke tests.

## Install

Download `aic-notes-30.0.1.vsix` and `aic-notes-30.0.1.vsix.sha256` from the
[v30.0.1 release](https://github.com/ldzyha/aic-notes/releases/tag/v30.0.1). The VSIX is universal:
use the same file on Windows, Linux, macOS, and code-server.

Windows PowerShell:

```powershell
(Get-FileHash .\aic-notes-30.0.1.vsix -Algorithm SHA256).Hash.ToLower()
Get-Content .\aic-notes-30.0.1.vsix.sha256
code --install-extension .\aic-notes-30.0.1.vsix --force
```

Linux, macOS, or code-server:

```sh
sha256sum -c aic-notes-30.0.1.vsix.sha256
code --install-extension ./aic-notes-30.0.1.vsix --force
# or: code-server --install-extension ./aic-notes-30.0.1.vsix --force
```

Reload the VS Code window after installation. No additional executable or library is required.

## Local note model

- `*.md` is a normal local Markdown document shown in the full AIC Markdown editor.
- `*.note.md` is a local contextual note that can open in the main editor or linked sidebar.
- A file note sits beside its source: `src/cart.js` → `src/cart.note.md`.
- A folder note sits beside its folder: `src/components/` → `src/components.note.md`.
- A project note sits at the workspace root: `demo/` → `demo.note.md`.
- Closing every file buffer follows the current workspace project note. If it does not exist, an
  editable gray placeholder appears; the file is created only after content changes and
  `Ctrl/Cmd+S`.
- The Notes & Documents tree indexes existing workspace Markdown files and lazy project-note
  placeholders. There is no global note and no separate search surface.

Pin affects only automatic following. Explicitly opening a file, folder, project, tree item, or
note always routes to the requested context. An unsaved note stays visible until it is saved, so a
tab event cannot silently discard its draft.

## Saving and deleting

`Ctrl/Cmd+S` is the only persistence boundary for Secondary notes. Typing and blur never save.
The pane is softly amber while unsaved, neutral after a successful local save, and gray for an
unmaterialized placeholder. Ordinary Markdown documents use the same explicit VS Code save action.

Trash is local and recoverable. The footer Trash action and tree delete commands ask for
confirmation, then use the operating-system Trash where VS Code supports it. They never contact or
modify another application.

When upgrading from a synchronization-capable release, AIC Notes removes only its retired local
session key, encrypted session directory, and workspace bindings. Existing `*.md` and `*.note.md`
files are preserved unchanged. No remote request is made during cleanup.

## Editor interactions

The document remains exact Markdown source. Preview structures disclose only the source being
edited; there is no document-wide preview/edit mode switch.

On an otherwise empty Markdown line, type `/` to open the shared template catalog. It works in the
AIC Markdown editor, VS Code's native Markdown editor, unsaved Markdown documents, and contextual
`.note.md` notes; every adapter consumes the same catalog. Empty documents put complete pages first;
an existing page puts structural sections first.
Choose a result, then use `Tab` to move through its highlighted questions and replace the example
answers. The compact menu separates Pages, Structure, Review, References, Tables & lists, Diagrams,
and Blocks. Completion stays inactive inside fenced/inline code
and in read-only documents.

- Text, headings, lists, tasks, quotes, emphasis, and fenced languages edit directly.
- `Ctrl/Cmd+A` selects the full Markdown source, including from preview mode. Dragging over preview
  text keeps a stable native selection for copying; Edit reveals that block's Markdown source.
- Links open on the main click. Their Open, Copy, and Edit icon controls remain visible without a
  hover-only gap.
- Code blocks render as preview cards with Copy and Edit controls.
- Mermaid diagrams render in place with Copy, Edit, zoom, two-dimensional scrolling, fit, and 90°
  rotation controls.
- Tables use content-sized columns, word-level wrapping, a dedicated horizontal scroller, Copy,
  row/column insertion, and drag reordering. A transient popover textarea appears only for the
  selected cell.
- Frontmatter properties render only for `*.note.md`. New sidecars receive exactly `file`,
  `created`, and `updated`; `updated` changes on explicit save. Values support nested YAML,
  transient popover editing, insertion, and drag reordering. Ordinary `*.md` documents do not
  receive generated properties.
- A read-only context tree appears directly under note properties only when frontmatter exists. It
  is derived from actual workspace notes and shows project, note-bearing parents, current target,
  children, and nearby notes; it is not stored in the Markdown and cannot be edited. Project and
  current-target placeholders remain navigable; absent ancestor folders are omitted.
- AIC details blocks preserve accordion state, task-checkbox interaction, source comments, and
  linked targets.

All action icons use CSS SVG masks. The DOM does not depend on inline SVG support from a host
renderer.

## Commands

- **AIC Notes: Open Linked Note** (`Ctrl/Cmd+Alt+N`)
- **AIC Notes: Link Selection to Note** (`Ctrl+Alt+L` / `Cmd+Alt+L`, with
  `Ctrl/Cmd+Shift+/` as an alias)
- **AIC Notes: Open Project Note**
- **AIC Notes: Open Note in Secondary Side Bar**
- **AIC Notes: Open Target**
- **AIC Notes: Copy Wiki Link**
- **AIC Notes: Refresh**
- **AIC Notes: Enable Explorer Nesting for Notes**
- **AIC Notes: Use Native Editor for Plain Markdown**
- **AIC Notes: Delete Note** / **Delete All Notes in Folder**
- **AIC Notes: Enable AIC Agent Workflow** / **Sync Agent Instructions**

Link Selection saves the source file first, copies its selected lines into one deduplicated AIC
details block, opens the linked sidecar at the comment caret, and never modifies source bytes.

## Optional AIC agent workflow

The agent workflow is independent of note persistence. Enabling it writes only a thin
`.vscode/aic-agent.json` marker and uses the configured `aic` executable for typed rule status and
rule synchronization. Configure `aicNotes.agentWorkflow.aicPath` only when `aic` is not on the
extension host's `PATH`.

## Development and release

```sh
npm ci
npm test
npm run build
npm run release:gate
```

`npm run release:gate` builds one `aic-notes-<version>.vsix`, creates its SHA-256 sidecar, and
inspects the archive. The gate rejects native/WASM helpers, platform targeting, development source,
retired synchronization commands/settings, incomplete editor controls, secrets, and checksum
mismatches.

Release versions use `R.F.B`: release sequence, shipped feature outcomes, and fixed-bug outcomes.
`30.0.1` is sequence 30 with zero feature outcomes and one prior-release fixed-bug outcome.

See [FUNCTIONAL_INDEX.md](FUNCTIONAL_INDEX.md) for the release-critical behavior map and
[PROVENANCE.md](PROVENANCE.md) for the shared-core snapshot identity.
