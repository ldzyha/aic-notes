# AIC Notes

AIC Notes is a local Markdown editor for VS Code/Code. It edits every `*.md` document with the AIC
preview-first surface and keeps contextual `*.note.md` sidecars in the Secondary Side Bar. There is
no account, cloud transport, background synchronization, polling, or remote conflict state.

The independent [AIC for Standard Notes](https://github.com/ldzyha/standard-notes-aic) plugin shares
the editor-core contract, but it is a separate product. AIC Notes does not connect to Standard Notes
and does not move data between the two applications.

## Install

Download `aic-notes-24.1.0.vsix` and `aic-notes-24.1.0.vsix.sha256` from the
[v24.1.0 release](https://github.com/ldzyha/aic-notes/releases/tag/v24.1.0). The VSIX is universal:
use the same file on Windows, Linux, macOS, and code-server.

Windows PowerShell:

```powershell
(Get-FileHash .\aic-notes-24.1.0.vsix -Algorithm SHA256).Hash.ToLower()
Get-Content .\aic-notes-24.1.0.vsix.sha256
code --install-extension .\aic-notes-24.1.0.vsix --force
```

Linux, macOS, or code-server:

```sh
sha256sum -c aic-notes-24.1.0.vsix.sha256
code --install-extension ./aic-notes-24.1.0.vsix --force
# or: code-server --install-extension ./aic-notes-24.1.0.vsix --force
```

Reload the VS Code window after installation. No additional executable or library is required.

## Local note model

- `*.md` is a normal local Markdown document shown in the full AIC Markdown editor.
- `*.note.md` is a local contextual note shown only in the Secondary Side Bar.
- A file note sits beside its source: `src/cart.js` → `src/cart.note.md`.
- A folder note sits inside its folder: `src/` → `src/src.note.md`.
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
The pane is neutral while editing, lightly green after a successful local save, and gray for an
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

- Text, headings, lists, tasks, quotes, emphasis, and fenced languages edit directly.
- `Ctrl/Cmd+A` selects the full Markdown source, including from preview mode. Selecting preview
  text reveals the corresponding source range for editing.
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
  is derived from the workspace and shows project, parents, current target, children, and nearby
  notes; it is not stored in the Markdown and cannot be edited.
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
`24.1.0` is sequence 24 with one feature outcome and no fixed-bug outcomes.

See [FUNCTIONAL_INDEX.md](FUNCTIONAL_INDEX.md) for the release-critical behavior map and
[PROVENANCE.md](PROVENANCE.md) for the shared-core snapshot identity.
