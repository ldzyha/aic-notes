# AIC Notes

AIC Notes is a public VS Code/code-server extension for Markdown documents and file-linked sidecar notes.
Source files stay in the editor. Every `*.note.md` sidecar stays in the **Secondary Side Bar**, where
it follows the active file until pinned, stays directly editable, and synchronizes only after explicit save
with Standard Notes.

The complete, test-owned behavior map is in [`FUNCTIONAL_INDEX.md`](FUNCTIONAL_INDEX.md).

## Install on VS Code or code-server

Download `aic-notes-20.1.6-linux-x64.vsix` and its `.sha256` file from the
[v20.1.6 release](https://github.com/ldzyha/aic-notes/releases/tag/v20.1.6), then verify and install:

```sh
sha256sum -c aic-notes-20.1.6-linux-x64.vsix.sha256
code-server --install-extension aic-notes-20.1.6-linux-x64.vsix --force
```

Reload the browser window after installation. The extension targets Code/VS Code 1.106 or newer;
the bundled Standard Notes helper in this release targets Linux x64.

For local 64-bit Windows VS Code, install the matching `win32-x64` VSIX:

```powershell
code --install-extension .\aic-notes-20.1.6-win32-x64.vsix --force
```

Then run **Developer: Reload Window**. Do not install the Linux VSIX into Windows VS Code. Windows
sync runs the same MIT Go bridge core as in-process WebAssembly, so Smart App Control does not need
to launch or trust an unsigned helper executable.

## Use notes

- Open the **Notes** Activity Bar item to see project Markdown. Every `*.note.md` sidecar is marked
  **Note**; every other `*.md` file is marked **Document** and opens as a normal Markdown document.
- **Project note** is always the first row for a workspace, even before its file exists. Click that
  row or the root-folder icon in the view title; the first edit plus `Ctrl+S` creates
  `<workspace-name>.note.md`.
- Press `Ctrl+Alt+N` on Linux/Windows or `Cmd+Alt+N` on macOS to open or create the linked note.
  Change the binding for `AIC Notes: Open Linked Note` in Keyboard Shortcuts at any time.
- Use the note icon in an ordinary file's editor title to open its existing sidecar or explicitly
  create one. Merely focusing a file never creates a note.
- From VS Code Explorer, choose **Open Linked Note** on a folder. A normal folder maps to its
  sibling `<folder>.note.md`; the workspace root maps to `<workspace-name>.note.md`. Both use the
  same editable, no-write-until-explicit-save placeholder as file notes. The cross-project global
  `~/.config/aic/note.md` entry and command are intentionally absent.
- An unpinned Secondary pane always follows the active source; **Pin** freezes the current
  relationship. When no file buffer is active, it shows the lazy project note for the most recently
  active workspace (or the first workspace in a fresh multi-root window). The title follows the note
  filename and its parent path is a read-only breadcrumb.
  The icon-only footer exposes **Log in/Log out** and **Pin**. **Source** appears whenever the
  current note has an existing owner, and one **Move note to Trash** action appears for every
  existing writable note; neither depends on Pin. There is no manual Sync button or
  Preview/Edit switch:
  an attached note is an editor unless Standard Notes reports its item or session as read-only.
  Opening a `*.note.md` through Explorer, Quick Open, a link, a restored tab, or a command is
  intercepted and routed to this panel; the note is not left in an editor tab.
- When no sidecar exists, the Secondary panel shows its complete fresh-note seed as an editable
  placeholder. Viewing, editing, or focusing it writes nothing; the first explicit `Ctrl/Cmd+S`
  atomically persists the canonical `*.note.md` bytes and continues in the same editor.
- Select source text and press `Ctrl+Alt+L` on Linux/Windows or `Cmd+Alt+L` on macOS
  (`Ctrl/Cmd+Shift+/` remains a compatibility alias), or choose **AIC Notes: Link Selection to
  Note** from the editor context menu. The extension first saves a dirty file so line anchors
  always identify persisted bytes, then adds one deduplicated, initially open details block under
  `## Linked code`. Its summary contains a
  checkbox and compact `file · Lx–Ly` link; the copied selection and an editable comment live inside.
  Clicking the link returns to the exact source lines. The source file is never modified.
- Use the footer **Move note to Trash** icon on an existing note. One confirmation moves the exact
  bound Standard Notes item to its recoverable Trash first, then moves the local sidecar to the
  operating-system Trash. An unbound note is local-only. Remote failure leaves the local file in
  place; local failure after remote success retains the binding so the idempotent action can be
  retried safely. Permanent local deletion is offered separately only when Trash is unavailable.

The sidecar mapping remains AIC-compatible:

- `src/app.js` → `src/app.note.md` (the last file extension is replaced)
- `.env` → `.env.note.md`; `Makefile` → `Makefile.note.md`
- folder `src/components/` → sibling `src/components.note.md`
- project note → `<workspace-name>.note.md`
- project-global notes → `.aic/notes/*.note.md`

Fresh notes contain only the managed `file`, `created`, and `updated` frontmatter properties,
a blank separation, and two
action sections: `## Todo` and `## Open questions`, each with an empty checklist item. Folder and
project templates remain unchanged. A workspace can override templates in
`.aic/templates/{file-note,folder-note,project-note}.md`.

Selection links follow the same AIC owner rule for `*.ai.md`: the project-level artifact maps to the
project note; every other artifact maps only when the exact file or folder owner exists. Ambiguous
or missing owners fail closed instead of creating an orphan sidecar. Line anchors identify the
persisted source revision at link time and may need to be recreated after later line movement.

## Markdown

Ordinary `*.md` files open in the AIC Markdown custom editor. Sidecars use the same renderer in the
Secondary Side Bar. Its compact layout keeps controls, headings, tables, and body copy legible in a
narrow pane while preserving visible theme-derived foregrounds. The Secondary view always exposes
the Markdown editor and persists changes through the VS Code document model. If the linked remote
item is locked, the same view becomes fixed read-only after synchronization; there is no
local mode toggle. The visual/editor contract follows AIC for Standard Notes v15.1.2: exact
Markdown remains the only persisted value while headings, emphasis, tasks, lists, links,
frontmatter properties, tables, fenced code, and Mermaid are rendered in place.

Details use exact `>>>|open| Title` / `>>> Title` / standalone `<<<` markers. The title and real SVG
chevron toggle disclosure; open cards join their summary and body on a dedicated sidebar-derived
surface. A link label opens directly and keeps compact **Copy** and **Edit** actions beside it—there
is no second tooltip surface. **Table** and **Properties** previews show static, selectable values
and open one focused editor popover only after activation. They add data and reorder rows/columns
with drag handles. Nested maps and sequences preserve visible indentation
levels, structural groups remain protected, and a moved property carries its complete branch only
among valid siblings; every action replaces exactly one valid Markdown block.
A non-empty selection reveals raw Markdown for every preview block it crosses;
`Ctrl+A`/`Cmd+A` therefore exits preview for the complete document. A collapsed cursor retains
preview, while **Edit** still opens one focused source block.
Table columns size to their content and wrap only at word boundaries. The table fills its card and
places only the grid inside a horizontal scroller when its readable columns are wider than the editor.
The explicit **Edit** action reveals and focuses the full raw source for that structure. In read-only
notes the same action reveals exact non-editable Markdown.

Mermaid previews keep Zoom out, Zoom in, Reset, and Rotate actions permanently visible. Rotate
turns the diagram clockwise by 90° per activation; Reset restores both 100% scale and the original
direction. A dedicated focusable viewport scrolls on both axes after zoom or rotation, while the
outer preview remains stable and the fenced Markdown stays hidden until an explicit edit.

Run **AIC Notes: Use Native Editor for Plain Markdown** if ordinary Markdown should use VS Code's
text editor. This does not relax the `*.note.md` Secondary-only rule.

## Standard Notes synchronization

Synchronization covers every workspace `*.md` file. Initial connection first pulls the complete
project inventory and then reconciles local Markdown whether or not a file has been opened.
For sidecars, before authentication or any API request, AIC Notes rejects empty/frontmatter-only
content, an unchanged generated placeholder, and a scaffold
containing only headings plus empty unchecked tasks. These states remain local and do not create or
modify a Standard Notes item; the explicit recovery sync command applies the same admission gate.

For substantive notes:

1. Open a sidecar in the Secondary panel and choose the footer **Log in** icon.
2. Enter the Standard Notes account email/password. MFA is
   requested when the server requires it.
   Immediately after a successful first login, AIC Notes pulls notes attached to the current
   workspace's AIC tag hierarchy. If the encrypted session was already present before upgrading,
   run **AIC Notes: Pull Project Notes from Standard Notes** once.
3. Credentials are sent only to the local Go helper for authentication and are not persisted.
   Session tokens and encryption material are stored in an AES-256-GCM encrypted file under the
   extension's global storage; its independent 256-bit wrapping key is held by VS Code
   `SecretStorage`. Session secrets are never written to settings, workspace state, logs, or the
   repository. This works in headless code-server without Secret Service, GNOME Keyring, or
   `secret-tool`.
4. The workspace stores only the remote item UUID, last common content hash, sync timestamp, and
   exact titles plus UUIDs of the last AIC-managed native tag path.
5. `Ctrl/Cmd+S` inside an attached note drains the current draft, normalizes its managed `file`,
   stable `created`, and fresh `updated` properties, saves locally, and schedules one serialized
   sync. Dates render in the user's locale while their portable UTC source stays stable. Saving an
   ordinary Markdown document schedules the same sync after its local save, including in VS Code's
   native editor, but creates no properties; the old three-field auto-header is removed when its
   exact legacy signature is present. Repeated explicit-save requests collapse to the newest
   persisted Markdown. Automatic sync never opens a login prompt: a disconnected note
   stays safely local and shows a compact login status. **AIC Notes: Sync Current Note** remains an
   explicit command-palette recovery action and may offer Connect/Reconnect.
6. First sync creates one Markdown note. Later syncs use a three-way comparison. One-sided changes
   propagate; two-sided changes stop and ask whether the complete local or Standard Notes body is
   authoritative. Nothing is merged silently, and a remote result never replaces text typed while
   its network request was in flight. The completed request still advances the common base, so the
   next save sends only that newer local change instead of producing a false conflict. Identical
   unbased bodies bind without a prompt; byte-identical duplicate remote identities choose the same
   stable UUID on every client. If old clients left divergent copies at one exact identity, a unique
   local-body match binds automatically. Otherwise one picker previews every remote copy and offers
   the local file; the chosen UUID and common base are persisted, so the question is not repeated.
   No unselected Standard Notes item is deleted or overwritten.
7. A Standard Notes `locked` item or read-only account session never receives a push. The Secondary
   editor becomes read-only and remains so until a later sync reports write access again.

Project pull accepts the current native nested tag hierarchy and the older AIC
`project:*`/`path:*` and dotted-tag layouts. Canonical sidecars use unambiguous AIC `project-note`,
`folder-note`, or `file-note` frontmatter; an ordinary remote document must have an exact safe
Markdown filename such as `README.md`, while a free-standing note retains its full `*.note.md`
title. Missing local Markdown is created only when its real parent directory already exists.
Byte-identical duplicate identities collapse to one stable import candidate; different identities
that collide at one local destination and unrelated Standard Notes notes fail closed. Differing
local content is bound for one later three-way decision and is never overwritten by bulk pull.
One legacy canonical root note with matching `project-note` frontmatter is recovered when it has no
active tag, then attached to the native project tag on normal sync. Historical duplicate active
project roots are read as one logical inventory. Existing notes remain on their own physical branch;
new attachments choose one stable branch. A malformed hierarchy, conflicting logical paths for the
same UUID, multiple untagged root notes, or a note owned by another tag still fails closed.

The footer and Notes Explorer Trash actions are two-sided. They target only UUIDs stored in
local bindings, mark those exact Standard Notes notes as trashed, remove their AIC-managed tag
references, then trash each local sidecar. They never title-match, create a replacement, or
permanently delete remote content. Missing, ambiguous, locked, or read-only remote identity fails
closed. A partial grouped local failure retains only the bindings still needed for retry.

**Log out** removes only the encrypted local Standard Notes session after confirmation. It does not
revoke remote tokens, delete the SecretStorage wrapping key, remove local notes or workspace sync
bindings, or alter Standard Notes items.

Each synchronized Markdown file is assigned to exactly one leaf in a native Standard Notes tag hierarchy:

- root note: `<workspace-root-name>`
- nested note: `<workspace-root-name> → <parent> → <child>`

Every child carries the official `TagToParentTag` reference to its exact parent UUID; only the leaf
references the note. The filename is not included. If the bundled bridge cannot express native
nesting, it keeps only `<workspace-root-name>` and never creates a dotted pseudo-hierarchy.

A successful migration removes only that note's legacy `aic`, `project:*`, `path:*`, and previously
recorded dotted-tag references, retires an emptied legacy tag, and records the exact native UUID
path for safe future sync and Trash cleanup. Same-title children under different parents remain
distinct. Shared references and every unrelated Standard Notes tag are preserved; duplicate or
contradictory candidates fail closed instead of guessing.

The default server is `https://api.standardnotes.com`. Self-hosted users can change
`aicNotes.standardNotes.server`. Upgrading from 4.3.3 requires one new **Connect** because the new
vault deliberately does not read or migrate the old operating-system-keyring session; it does not
delete that old entry or change remote notes. There is no timer or polling.

The bridge sends the current Standard Notes client/version headers on authentication and sync
requests. Connection failures are classified without echoing server responses or credentials:
unreachable server, TLS verification, incompatible endpoint, unsupported client, and rejected
authentication each produce a specific corrective action. The generic `sn_connect_failed` remains
only for failures that cannot be safely classified.

## Portable AIC agent workflow

AIC Notes can connect coding agents to the same provider-neutral AIC process on every project and
device without copying prompt text:

1. Install AIC on the device so `aic guide --json` and `aic rules` are available. If code-server
   cannot find it on `PATH`, set `aicNotes.agentWorkflow.aicPath` to the absolute executable path.
2. Run **AIC Notes: Enable AIC Agent Workflow** once for a trusted workspace and commit
   `.vscode/aic-agent.json` with the project.
3. New devices detect that marker when the project is cloned. Installation/update checks
   `aic rules status --json` and safely synchronizes missing or stale AIC-owned rules through
   `aic rules sync --json`. Start a new agent session after a sync.

The `.vscode` marker contains only schema/version and canonical discovery commands. It never copies
the global instruction pack, stores agent/user identity, or rewrites owner-authored `AGENTS.md`.
Agents obtain English practice, documentation/diagram rules, broad-to-specific `AGENTS.md` /
`*.note.md` / `*.ai.md` context, recovery, bounded waves, and literal `GO` to verified `DONE` from
the live versioned AIC guide. If existing global instruction files are not AIC-managed, the
extension fails closed and asks the owner to use the official AIC installer or review replacement.

## Build and verify

Requirements: Node.js 20.19+, npm, and Go 1.25.1 for the Linux and WebAssembly helpers.

```sh
npm ci
npm test
npm run build
cd bridge && go test ./... && CGO_ENABLED=0 go build -trimpath -o ../bin/linux-x64/aic-notes-sn-bridge .
GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -trimpath -o ../bin/wasm/aic-notes-sn-bridge.wasm .
# Copy lib/wasm/wasm_exec.js from the exact Go toolchain into ../bin/wasm/.
cd .. && npm run package
```

The bridge is built directly on the MIT `gosn-v2` commit recorded in
[`PROVENANCE.md`](PROVENANCE.md); it does not use or bundle AGPL `sn-cli`. The extension invokes the
helper with `execFile`, no shell, bounded JSON, a 45-second timeout, and bounded output.

Focused unit tests cover sidecar paths/templates/frontmatter, selection range/link/deduplication
rules, placeholder creation and pre-auth sync admission, raw checkbox authoring, serialized sync
coalescing, exact-binding two-sided Trash, release manifest invariants, three-way decisions,
managed-tag migration boundaries, sanitized connection failures, mandatory client headers on
auth/sync, and the bridge protocol. A live
Standard Notes account is intentionally not mutated by unattended tests.

## Release accounting

This project uses the global `R.F.B` convention: release sequence, release-local feature outcomes,
release-local fixed-bug outcomes. `20.1.6` is sequence 20 with one feature outcome and six
fixed-bug outcomes. It is not a SemVer compatibility claim. See [`CHANGELOG.md`](CHANGELOG.md).

## License and provenance

AIC Notes is MIT licensed. Vendored/runtime provenance and third-party notices are in
[`PROVENANCE.md`](PROVENANCE.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and
[`vendor/markdown/PROVENANCE.md`](vendor/markdown/PROVENANCE.md).
