# AIC Notes

AIC Notes is a local Markdown editor for VS Code/Code. It edits every `*.md` document with the AIC
preview-first surface, including `*.note.md`, and shows linked notes in the Secondary Side Bar.
The extension is fully local: no Standard Notes sign-in, account requests, note synchronization,
polling, upload, remote deletion or remote conflict state. Copy blocks manually when needed.

## AIC fields and source mode

The main editor and linked-note sidebar consume the same bounded `aic` document
renderer as Standard Notes. Each separator types the next value: `|` text, `*|`
secret, `#|` authenticator seed, `_|` card, `1|` unused one-time value and `0|`
used one-time value. A label before the first separator is optional, and a row can
combine differently typed parts:

```aic
# Account
Login | person@example.test
Password *| synthetic-secret
Card _| 4111111111111111 | 12/30 *| 123
Recovery codes 1| code-one 0| already-used
```

Account, Card and One-time codes are presets made from these parts, not additional
types. Copying an unused `1|` value marks it `0|`; activating a used value restores
`1|` without copying, and only used values expose removal. Field inserts a typed
part in the current row, Row inserts below it and Section inserts after the current
section. Mutations use the existing VS Code save/undo contract.

The single **Show Markdown source / Show preview** icon toggles AIC previews in
place. Source, Undo, dirty state and save rules do not change. The mode is temporary
for the current note, and raw Markdown can expose visually masked values. The local
**?** guide is shared with the other hosts and works without note, storage or
network access.

Legacy YAML Properties, colon fields and prior Security forms remain exact raw
Markdown for manual repair. They are not rendered, stamped, reordered or migrated
automatically. Filesystem timestamps may still exist as VS Code metadata, but the
editor and linked-note header do not display created/updated dates.

## Security field actions

### Authenticator JSON conversion

Open an original Authenticator JSON array in AIC Markdown, or select the complete array
inside a document. **Convert and save security blocks** appears for recognized records with
`service`, `account` and `secret` strings. The shared converter creates one `aic`
block with independent sections: Service/Account/Notes are visible; TOTP, Password and extra string fields
are hidden. Safe service URLs also gain a separate Open-capable URL field.
Standalone `---` separates sections; headings are optional. Overflow moves to further
blocks without dropping data. The preview shows limits (16 sections, 64 fields per section,
65,536 text units per block, 16,384 per field including all pipe parts and escapes)
and disables additions that would exceed them.
New block stays available. Group blocks by purpose, for example services, banks, web or
social networks. Existing notes are never automatically repartitioned.

Conversion is one explicit edit, undoable with Ctrl/Cmd+Z, saved through the same parent
manager as other security actions. It works in the main editor and linked-note sidebar. It does not scan the account,
read the clipboard, migrate native note types or synchronize notes. Invalid records,
duplicate keys or unsupported values reject the whole array without partial edits.
The maximum is 256 records / 1 MiB UTF-8 source. Credential strings are never guessed,
trimmed or repaired; use valid original JSON rather than Markdown-escaped credential text.

### Copy, Paste and generation

Tap/click a security field label to copy the label itself (for example a username), or its
value to copy the stored value. “Copied” briefly overlays the pressed target after success.
Tab navigates; Enter/Space activates. The field icon is **Paste**,
present only for empty fields, alongside Delete empty field. Filled fields have neither button.
There is no Replace action.
Whole-block Copy remains in the header; filled fields can be copied, but changing their
values requires source Edit. URL Open and TOTP controls are unchanged. Security preview
mutations save immediately through the parent manager. Ordinary typing saves on Ctrl/Cmd+S,
Save or leaving the editing surface, not on each input. The saved state requires acknowledgement.

Paste directly reads the latest text using VS Code's
[native clipboard API](https://code.visualstudio.com/api/references/vscode-api#Clipboard),
through a bounded, identity-bound request. There is no AIC dialog, intermediate input or
history picker on success. Hidden values are never previewed; empty clipboard text makes
no change. Only denied/unavailable/timed-out access offers inline masked paste-only capture.
Standard Notes uses the [browser API](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText),
which may show its own permission prompt. AIC cannot bypass platform clipboard permissions
and does not read or store clipboard history.

An empty hidden password field (`Password*`, `PWD*`, `Пароль*`, `WebDAV Password*` and
recognized service-qualified labels) offers **Generate password**. Default: 24 characters,
uppercase/lowercase/numbers/symbols enabled; length 8–128 and groups are configurable.
Each enabled group occurs at least once. No existing value is overwritten or automatically
copied/revealed. Clear through source Edit and return to preview to generate again.
TOTP/API keys and arbitrary masked labels are not password-generation targets.

Both products use the same local [Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/getRandomValues)
generator and UI. Options are inspired by [1Password](https://1password.com/blog/how-to-generate-random-password),
not the same implementation. Markdown, exports and clipboard values remain plaintext.

### Recovery codes and titles

**Add Recovery codes** adds a hidden batch field. Paste one code per line; empty lines are
ignored, exact spaces and duplicate codes retained. Codes remain masked and copy individually.
The reversible **Used** checkbox does not delete a code; copying is not proof that a service
accepted it. Whole-block Copy preserves codes and their used flags in another document.

Without an independent `#` card title, the first section title replaces the card name,
without a duplicate heading row. Use `## Account name` for a custom name or bare `##`
for the default Security header.

The independent [AIC for Standard Notes](https://github.com/ldzyha/standard-notes-aic) plugin shares
editor-core 6.1.0 but is a separate product. The coordinated release targets are AIC Notes
45.1.0 and AIC for Standard Notes 37.2.0. This page describes the release contract;
published artifacts are verified separately by the release workflow. Transfer content manually
between the two applications; VS Code has no Standard Notes account integration.

## Coordinated release — 45.1.0

This release adds **Copy section** in each AIC section header in the main editor
and Linked Note. It copies a standalone fenced `aic` block containing only that
section, including masked and filter-hidden rows, without the card title or sibling
sections. The shared serializer preserves logical labels, exact value text and
typed parts; authored whitespace and quoting may be normalized. Copy works in
read-only views, guards stale controls and does not edit or save the note.

Core 6.1.0 adds this action without changing the typed-pipe grammar. The separate
browser 0.4.0 release adds Global Shared inside its encrypted browser-profile vault;
it is not a VS Code feature or a connection between applications. The proposed
generated-key and VS Code `global.aic` encryption architecture remains unimplemented.
The extension remains local-only, with no account connection or synchronization.
Release assets require separate verification; no Standard Notes PWA crash fix is claimed.

The prior 44.4.7 release retired the native Notes & Documents tree, adopted typed
`aic` values and the local guide, aligned compact field actions and kept one source
toggle in the main footer. Core 6.0.0 introduced the breaking grammar: colon fields
and YAML Properties remain exact raw text for manual repair, without automatic
stamping or migration. Typed values use `|`, `*|`, `#|`, `_|`, `1|`, and `0|`.

The prior 43.0.1 release fixed the compact inline card row and introduced the additive,
partially adopted shared component IDs, BEM helpers and geometry tokens.

The prior 42.0.3 release fixed compact generic pipe fields and repeated parsing,
viewport-bounded Add menus, and caret visibility. Its additive `previewOnly` API
supported the separate browser host without adding a VS Code feature.

The previous 41.1.1 release added quoted value slots to Security and opt-in v2 Properties,
and fixed literal-pipe handling outside the exact spaced separator. Historical Security
formats require manual source repair; no notes are automatically rewritten.

The shared AIC templates insert the same `aic` Markdown block
as the Standard Notes plugin. A standalone `---` starts another section;
`## Main` optionally titles one. Each value starts with `|`, `*|`, `#|`, `_|`,
`1|`, or `0|` for text, secret, TOTP, card, unused one-time, or used one-time
data. Add Field targets the current row, Add Row inserts below, and Add Section
inserts after the current section. Account/Card/One-time codes are presets made
from those value types; Email and URL remain text. Edit opens raw Markdown.
Preview can copy individual values, one-time codes and the complete fenced block, or open a safe
HTTP(S) URL. Save, Ctrl/Cmd+S and leaving the surface share the same persistence manager. This is
visual masking only: raw Markdown, other editors, local files, exports and
copied blocks still contain plaintext secrets. There is no QR import UI. It
does not enable Standard Notes synchronization or convert native Authenticator
notes.

Both editors share task controls, details parsing, code-language aliases and the bounded
Mermaid render queue. Nested inputs own their selection; Ctrl/Cmd+A inside a diagram field
does not select the surrounding Markdown document.

Linked-code comments are inserted into the live sidebar draft, not written through a separate
filesystem path. Save and Trash revalidate document identity,
revision, editing ownership and the originating view after asynchronous work. Provider-owned
scopes retire subscriptions and pending requests when a surface closes.

The File Context sphere and the native Notes & Documents tree have been removed.
Linked Note, source following, Explorer commands and contextual parent-note
relationships remain; existing Markdown and sidecar files are not migrated or deleted.

## Editor features — shared editor core 6.1.0

This release target pairs with AIC for Standard Notes 37.2.0. The release gate must
byte-verify their shared core and run automated tests and production builds. Prior Windows
browser checks cover the shared controls but do not replace final package verification;
Linux desktop smoke checks are not implied.

- `/page`, `/section`, `/context` and `/implementation` follow Core's question → answer → detail
  structure, with dependency-ordered steps and verification where needed. There are no compulsory
  Purpose/Proposal sections. The same catalog works in AIC and native Markdown, including `.note.md`.
- `/list`, `/list-numbered`, `/checklist` and `/table` insert an unordered list, ordered list,
  bare checkbox list and simple table. `/checkbox` and `/tasklist` also find `/checklist`;
  `/tasks` remains the separate verification section.
- Explorer note clicks open just the note in the main editor. **Open Source** is a separate
  action that opens the source with its linked sidebar note; folder/project sources are revealed.
  Persisted legacy note associations resolve to the main editor without changing user settings.
  An unpinned sidebar follows the main note's nearest existing ancestor folder note, otherwise
  its workspace project note or lazy project placeholder. Folders without their own note are skipped.
  Unsaved sidebar drafts are preserved; repeated events for the same parent do not reset its editor.
- The note pane starts directly at its content, without a duplicate name, folder,
  created/updated date or save-status header. Saved notes are neutral; unsaved notes have a soft amber tint and a small
  change marker; placeholders are gray. Save, Ctrl/Cmd+S and leaving the surface commit the draft.
- Context ancestors require existing `.note.md` notes. Project navigation always remains,
  opening its note or placeholder; the actual current target can also be a placeholder.
- In the AIC editor, Mermaid source now retains its visual-editor button above the fence while
  the caret or a snippet field is inside it. Raw Markdown remains editable. `/class` finds
  `/class-diagram`; native VS Code text editors offer snippets but not the embedded canvas.
- `/noise` captures uncertainty; `/wave` develops a result and executable path in the same note.
  New default file/folder/project notes start with compact Noise guidance. Existing notes and
  accepted `.aic/templates/*.md` overrides are preserved exactly. Default empty notes use the
  current AIC template; no generated file/date Properties are added. There is no automatic
  noise/wave classification or grouping UI.
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
  copyable draft. Switching notes retires the old session. No per-keystroke autosave is added.
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

After publication, download `aic-notes-45.1.0.vsix` and its
`aic-notes-45.1.0.vsix.sha256` checksum from [AIC Notes releases](https://github.com/ldzyha/aic-notes/releases).
The VSIX is universal: use the same file on Windows, Linux, macOS, and code-server. Do not
substitute an older release's checksum for this candidate.

Windows PowerShell:

```powershell
(Get-FileHash .\aic-notes-45.1.0.vsix -Algorithm SHA256).Hash.ToLower()
Get-Content .\aic-notes-45.1.0.vsix.sha256
code --install-extension .\aic-notes-45.1.0.vsix --force
```

Linux, macOS, or code-server:

```sh
sha256sum -c aic-notes-45.1.0.vsix.sha256
code --install-extension ./aic-notes-45.1.0.vsix --force
# or: code-server --install-extension ./aic-notes-45.1.0.vsix --force
```

Reload the VS Code window after installation. Local editing requires no
additional executable; the optional agent workflow uses AIC only when explicitly enabled.

## Local note model

- `*.md` is a normal local Markdown document shown in the full AIC Markdown editor.
- `*.note.md` is a local contextual note that can open in the main editor or linked sidebar.
- A file note sits beside its source: `src/cart.js` → `src/cart.note.md`.
- A folder note sits beside its folder: `src/components/` → `src/components.note.md`.
- A project note sits at the workspace root: `demo/` → `demo.note.md`.
- Closing every file buffer follows the current workspace project note. If it does not exist, an
  editable gray placeholder appears; the file is created only after content changes and
  `Ctrl/Cmd+S`.
- There is no extension-specific Notes & Documents activity-bar tree or background
  workspace scan. Use the ordinary Explorer, editor commands and Linked Note pane;
  existing project-global and sidecar files remain available at their filesystem paths.

Pin affects only automatic following. Explicitly opening a file, folder, project, or
note always routes to the requested context. An unsaved note stays visible until it is saved, so a
tab event cannot silently discard its draft.

## Saving and deleting

Ctrl/Cmd+S, Save and leaving the editing surface persist Secondary notes. Security preview
mutations save immediately; ordinary typing does not save on each input. Wait for the acknowledged
saved state before terminating the app; an interrupted process cannot guarantee completion.
The pane is softly amber while unsaved, neutral after a successful local save, and gray for an
unmaterialized placeholder. Ordinary Markdown documents use the same explicit VS Code save action.

Trash is local and recoverable. The Linked Note footer Trash action asks for confirmation,
then uses the operating-system Trash where VS Code supports it. It never contacts or modifies
another application.

When upgrading from a synchronization-capable release, AIC Notes removes only its retired local
session key, encrypted session directory, and workspace bindings. Existing `*.md` and `*.note.md`
files are preserved unchanged. A separate exact-key cleanup removes the former VS Code
Standard Notes sign-in session from SecretStorage. Neither cleanup makes a remote request.

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
- One bounded fenced `aic` document owns structured fields. Each value begins with
  `|`, `*|`, `#|`, or `_|` to identify that value as text,
  secret, TOTP, or card data; a field can mix independently typed values. Click a
  label or value to copy it; supported empty values expose their local actions.
  `1|` marks an unused one-time value and `0|` its used state; successful Copy
  changes `1|` to `0|`, while reactivation does not copy.
  Masking is visual only: source Markdown and whole-block Copy can expose plaintext.
  Legacy YAML Properties remain exact raw Markdown for manual editing and are never
  interpreted, stamped, cleaned up, or migrated automatically.
- A read-only dependency tree appears before custom note properties when frontmatter exists. It
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
- **AIC Notes: Refresh**
- **AIC Notes: Enable Explorer Nesting for Notes**
- **AIC Notes: Use Native Editor for Plain Markdown**
- **AIC Notes: Delete Note** / **Delete All Notes in Folder**
- **AIC Notes: Enable AIC Agent Workflow** / **Sync Agent Instructions**

Link Selection requires an already saved source revision. It copies selected lines into one
deduplicated linked-code details block in the live sidebar draft and opens the comment caret.
It does not save the source or target implicitly; press Ctrl/Cmd+S in the note to persist it.

## Optional AIC agent workflow

The agent workflow is independent of note persistence. In a trusted workspace, enabling it writes
a thin `.vscode/aic-agent.json` marker; only an explicitly marked trusted workspace activates
automatic AIC rule verification/synchronization. The explicit **Sync Agent Instructions** command
also requires trust. An extension update by itself does not run AIC or change global instructions.
Configure `aicNotes.agentWorkflow.aicPath` only when `aic` is not on the extension host's `PATH`.

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
The coordinated version `45.1.0` records sequence 45, one feature outcome and zero fixed-bug
outcomes; it is not a publication marker by itself.

See [FUNCTIONAL_INDEX.md](FUNCTIONAL_INDEX.md) for the release-critical behavior map and
[PROVENANCE.md](PROVENANCE.md) for the shared-core snapshot identity.
