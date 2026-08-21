# AIC Notes

AIC Notes is a public VS Code/code-server extension for Markdown and file-linked sidecar notes.
Source files stay in the editor. Every `*.note.md` sidecar stays in the **Secondary Side Bar**, where
it can follow the active file, remain pinned, stay directly editable, and synchronize manually
with Standard Notes.

## Install on code-server

Download `aic-notes-5.3.1-linux-x64.vsix` and its `.sha256` file from the
[v5.3.1 release](https://github.com/ldzyha/aic-notes/releases/tag/v5.3.1), then verify and install:

```sh
sha256sum -c aic-notes-5.3.1-linux-x64.vsix.sha256
code-server --install-extension aic-notes-5.3.1-linux-x64.vsix --force
```

Reload the browser window after installation. The extension targets Code/VS Code 1.106 or newer;
the bundled Standard Notes helper in this release targets Linux x64.

## Use notes

- Open the **Notes** Activity Bar item to manage all existing sidecars in the Primary Side Bar.
- Press `Ctrl+Alt+N` on Linux/Windows or `Cmd+Alt+N` on macOS to open or create the linked note.
  Change the binding for `AIC Notes: Open Linked Note` in Keyboard Shortcuts at any time.
- Use the note icon in an ordinary file's editor title to open its existing sidecar or explicitly
  create one. Merely focusing a file never creates a note.
- Keep **Auto-open linked note** checked to reveal an existing sidecar when its source becomes
  active. The checkbox is workspace-scoped and defaults to checked. Uncheck it to stop forced
  reveals.
- Use **Pin/Unpin** and **Source** in the Secondary panel. There is no Preview/Edit mode switch:
  an attached note is an editor unless Standard Notes reports its item or session as read-only.
  Opening a `*.note.md` through Explorer, Quick Open, a link, a restored tab, or a command is
  intercepted and routed to this panel; the note is not left in an editor tab.
- When no sidecar exists, the Secondary panel shows the exact candidate path and a **Create note**
  button. Following a file never writes the placeholder to disk; only that button, the note icon,
  or an explicit command creates it.
- Select persisted source text and press `Ctrl+Shift+/` on Linux/Windows or `Cmd+Shift+/` on macOS
  (or choose **AIC Notes: Link Selection to Note** from the editor context menu). The extension
  adds one deduplicated, initially open details block under `## Linked code`. Its summary contains a
  checkbox and compact `file · Lx–Ly` link; the copied selection and an editable comment live inside.
  Clicking the link returns to the exact source lines. The source file is never modified.

The sidecar mapping remains AIC-compatible:

- `src/app.js` → `src/app.note.md` (the last file extension is replaced)
- `.env` → `.env.note.md`; `Makefile` → `Makefile.note.md`
- folder `src/components/` → sibling `src/components.note.md`
- project note → `<workspace-name>.note.md`
- project-global notes → `.aic/notes/*.note.md`

Fresh file notes contain the existing AIC frontmatter properties plus one empty `- [ ]` checklist
item. Folder and project templates remain unchanged. A workspace can override templates in
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
item is locked, the same view becomes fixed read-only after manual synchronization; there is no
local mode toggle. The
visual/editor contract follows AIC for Standard Notes v0.1.1: exact
Markdown remains the only persisted value while headings, emphasis, tasks, lists, links,
frontmatter properties, tables, fenced code, and Mermaid are rendered in place.

Run **AIC Notes: Use Native Editor for Plain Markdown** if ordinary Markdown should use VS Code's
text editor. This does not relax the `*.note.md` Secondary-only rule.

## Standard Notes synchronization

Synchronization is manual and sidecars only:

1. Open a sidecar in the Secondary panel and choose **Sync**.
2. On first use, choose **Connect** and enter the Standard Notes account email/password. MFA is
   requested when the server requires it.
3. Credentials are sent only to the local Go helper for authentication and are not persisted.
   Session tokens and encryption material are stored in an AES-256-GCM encrypted file under the
   extension's global storage; its independent 256-bit wrapping key is held by VS Code
   `SecretStorage`. Session secrets are never written to settings, workspace state, logs, or the
   repository. This works in headless code-server without Secret Service, GNOME Keyring, or
   `secret-tool`.
4. The workspace stores only the remote item UUID, last common content hash, and sync timestamp.
5. First sync creates one Markdown note. Later syncs use a three-way comparison. One-sided changes
   propagate; two-sided changes stop and ask whether the complete local or Standard Notes body is
   authoritative. Nothing is merged silently.
6. A Standard Notes `locked` item or read-only account session never receives a push. The Secondary
   editor becomes read-only and remains so until a later manual sync reports write access again.

Each synchronized note receives exactly these managed tags:

- `aic`
- `project:<workspace-root-name>`
- `path:<parent-path>` (`path:.` at the root)

Only these managed references are reconciled. Every unrelated Standard Notes tag and its
references are preserved. Deleted or ambiguous remote identity stops synchronization instead of
creating a duplicate.

The default server is `https://api.standardnotes.com`. Self-hosted users can change
`aicNotes.standardNotes.server`. Upgrading from 4.3.3 requires one new **Connect** because the new
vault deliberately does not read or migrate the old operating-system-keyring session; it does not
delete that old entry or change remote notes. There is no background, timer, on-save, or
ordinary-`.md` sync.

The bridge sends the current Standard Notes client/version headers on authentication and sync
requests. Connection failures are classified without echoing server responses or credentials:
unreachable server, TLS verification, incompatible endpoint, unsupported client, and rejected
authentication each produce a specific corrective action. The generic `sn_connect_failed` remains
only for failures that cannot be safely classified.

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
rules, release manifest invariants, three-way decisions, managed-tag boundaries, sanitized
connection failures, mandatory client headers on auth/sync, and the bridge protocol. A live
Standard Notes account is intentionally not mutated by unattended tests.

## Release accounting

This project uses the global `R.F.B` convention: release sequence, release-local feature outcomes,
release-local fixed-bug outcomes. `5.3.1` is sequence 5 with three feature outcomes and one
fixed-bug outcome. It is not a SemVer compatibility claim. See [`CHANGELOG.md`](CHANGELOG.md).

## License and provenance

AIC Notes is MIT licensed. Vendored/runtime provenance and third-party notices are in
[`PROVENANCE.md`](PROVENANCE.md), [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and
[`vendor/markdown/PROVENANCE.md`](vendor/markdown/PROVENANCE.md).
