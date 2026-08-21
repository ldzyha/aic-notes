# AIC Notes

AIC Notes is a public VS Code/code-server extension for Markdown and file-linked sidecar notes.
Source files stay in the editor. Every `*.note.md` sidecar stays in the **Secondary Side Bar**, where
it follows the active file until pinned, stays directly editable, and synchronizes after save/blur
with Standard Notes.

## Install on code-server

Download `aic-notes-7.3.2-linux-x64.vsix` and its `.sha256` file from the
[v7.3.2 release](https://github.com/ldzyha/aic-notes/releases/tag/v7.3.2), then verify and install:

```sh
sha256sum -c aic-notes-7.3.2-linux-x64.vsix.sha256
code-server --install-extension aic-notes-7.3.2-linux-x64.vsix --force
```

Reload the browser window after installation. The extension targets Code/VS Code 1.106 or newer;
the bundled Standard Notes helper in this release targets Linux x64.

## Use notes

- Open the **Notes** Activity Bar item to manage all existing sidecars in the Primary Side Bar.
- Press `Ctrl+Alt+N` on Linux/Windows or `Cmd+Alt+N` on macOS to open or create the linked note.
  Change the binding for `AIC Notes: Open Linked Note` in Keyboard Shortcuts at any time.
- Use the note icon in an ordinary file's editor title to open its existing sidecar or explicitly
  create one. Merely focusing a file never creates a note.
- An unpinned Secondary pane always follows the active source; **Pin** freezes the current
  relationship. The title follows the note filename and its parent path is a read-only breadcrumb.
  The icon-only footer exposes **Log in/Log out** and **Pin**. **Source**, **Clear**, and **Delete**
  appear only for a pinned existing note. There is no manual Sync button or Preview/Edit switch:
  an attached note is an editor unless Standard Notes reports its item or session as read-only.
  Opening a `*.note.md` through Explorer, Quick Open, a link, a restored tab, or a command is
  intercepted and routed to this panel; the note is not left in an editor tab.
- When no sidecar exists, the Secondary panel shows its complete fresh-note seed as an editable
  placeholder. Viewing or focusing it writes nothing; the first real edit atomically persists the
  canonical `*.note.md` bytes and continues in the same editor.
- Select source text and press `Ctrl+Alt+L` on Linux/Windows or `Cmd+Alt+L` on macOS
  (`Ctrl/Cmd+Shift+/` remains a compatibility alias), or choose **AIC Notes: Link Selection to
  Note** from the editor context menu. The extension first saves a dirty file so line anchors
  always identify persisted bytes, then adds one deduplicated, initially open details block under
  `## Linked code`. Its summary contains a
  checkbox and compact `file · Lx–Ly` link; the copied selection and an editable comment live inside.
  Clicking the link returns to the exact source lines. The source file is never modified.
- Pin a note to expose the footer **Clear content** and **Delete note** icons. Clear preserves a
  strictly valid leading properties block byte-for-byte and resets the remaining local body to `- [ ]`.
  Delete saves current bytes and moves only the local sidecar to Trash, with a separate permanent
  confirmation only when Trash is unavailable. Neither action changes a remote Standard Notes item.

The sidecar mapping remains AIC-compatible:

- `src/app.js` → `src/app.note.md` (the last file extension is replaced)
- `.env` → `.env.note.md`; `Makefile` → `Makefile.note.md`
- folder `src/components/` → sibling `src/components.note.md`
- project note → `<workspace-name>.note.md`
- project-global notes → `.aic/notes/*.note.md`

Fresh file notes contain the existing AIC frontmatter properties, a blank separation, and two
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
local mode toggle. The visual/editor contract follows AIC for Standard Notes v3.2.0: exact
Markdown remains the only persisted value while headings, emphasis, tasks, lists, links,
frontmatter properties, tables, fenced code, and Mermaid are rendered in place.

Details use exact `>>>|open| Title` / `>>> Title` / standalone `<<<` markers. The title and real SVG
chevron toggle disclosure; open cards join their summary and body on a dedicated sidebar-derived
surface. **Details**, **Mermaid**, **Table**, and **Properties** each expose **Edit source**. Clicking
preview content never reveals raw Markdown; explicit links, checkboxes, zoom, and disclosure keep
their own actions. In read-only notes, **Edit source** still reveals exact non-editable Markdown.

Run **AIC Notes: Use Native Editor for Plain Markdown** if ordinary Markdown should use VS Code's
text editor. This does not relax the `*.note.md` Secondary-only rule.

## Standard Notes synchronization

Synchronization is save-driven and sidecars only:

1. Open a sidecar in the Secondary panel and choose the footer **Log in** icon.
2. Enter the Standard Notes account email/password. MFA is
   requested when the server requires it.
3. Credentials are sent only to the local Go helper for authentication and are not persisted.
   Session tokens and encryption material are stored in an AES-256-GCM encrypted file under the
   extension's global storage; its independent 256-bit wrapping key is held by VS Code
   `SecretStorage`. Session secrets are never written to settings, workspace state, logs, or the
   repository. This works in headless code-server without Secret Service, GNOME Keyring, or
   `secret-tool`.
4. The workspace stores only the remote item UUID, last common content hash, sync timestamp, and
   exact last AIC-managed tag title.
5. `Ctrl/Cmd+S`, a VS Code save event for the attached sidecar, or leaving the Secondary editor
   drains pending edits, saves locally, and schedules one serialized sync. Save/blur bursts collapse
   to the newest persisted Markdown. Automatic sync never opens a login prompt: a disconnected note
   stays safely local and shows a compact login status. **AIC Notes: Sync Current Note** remains an
   explicit command-palette recovery action and may offer Connect/Reconnect.
6. First sync creates one Markdown note. Later syncs use a three-way comparison. One-sided changes
   propagate; two-sided changes stop and ask whether the complete local or Standard Notes body is
   authoritative. Nothing is merged silently, and a remote result never replaces text typed while
   its network request was in flight.
7. A Standard Notes `locked` item or read-only account session never receives a push. The Secondary
   editor becomes read-only and remains so until a later sync reports write access again.

**Log out** removes only the encrypted local Standard Notes session after confirmation. It does not
revoke remote tokens, delete the SecretStorage wrapping key, remove local notes or workspace sync
bindings, or alter Standard Notes items.

Each synchronized note receives exactly one AIC-managed hierarchical tag:

- root note: `<workspace-root-name>`
- nested note: `<workspace-root-name>.<parent>.<child>`

The filename is not included. A successful migration removes that note's legacy `aic`,
`project:*`, and `path:*` references, retires an emptied legacy tag, and records the new exact title
for safe future moves. Shared references and every unrelated Standard Notes tag are preserved.
Deleted or ambiguous remote identity stops synchronization instead of creating a duplicate.

The default server is `https://api.standardnotes.com`. Self-hosted users can change
`aicNotes.standardNotes.server`. Upgrading from 4.3.3 requires one new **Connect** because the new
vault deliberately does not read or migrate the old operating-system-keyring session; it does not
delete that old entry or change remote notes. There is no timer, polling, or ordinary-`.md` sync.

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

Requirements: Node.js 20.19+, npm, and Go 1.25.1 for the Linux helper.

```sh
npm ci
npm test
npm run build
cd bridge && go test ./... && CGO_ENABLED=0 go build -trimpath -o ../bin/linux-x64/aic-notes-sn-bridge .
cd .. && npm run package
```

The bridge is built directly on the MIT `gosn-v2` commit recorded in
[`PROVENANCE.md`](PROVENANCE.md); it does not use or bundle AGPL `sn-cli`. The extension invokes the
helper with `execFile`, no shell, bounded JSON, a 45-second timeout, and bounded output.

Focused unit tests cover sidecar paths/templates/frontmatter, selection range/link/deduplication
rules, placeholder creation, serialized sync coalescing, release manifest invariants, three-way
decisions, managed-tag migration boundaries, sanitized connection failures, mandatory client
headers on auth/sync, and the bridge protocol. A live
Standard Notes account is intentionally not mutated by unattended tests.

## Release accounting

This project uses the global `R.F.B` convention: release sequence, release-local feature outcomes,
release-local fixed-bug outcomes. `7.3.2` is sequence 7 with three feature outcomes and two
fixed-bug outcomes. It is not a SemVer compatibility claim. See [`CHANGELOG.md`](CHANGELOG.md).

## License and provenance

AIC Notes is MIT licensed. Vendored/runtime provenance and third-party notices are in
[`PROVENANCE.md`](PROVENANCE.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and
[`vendor/markdown/PROVENANCE.md`](vendor/markdown/PROVENANCE.md).
