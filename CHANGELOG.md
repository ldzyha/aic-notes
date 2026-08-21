# Changelog

## 9.0.1 — 2026-08-21

Release sequence 9 · 0 feature outcomes · 1 fixed-bug outcome.

- B01: Standard Notes tagging now creates or reuses the native
  `<project> → <parent> → <child>` graph with official `TagToParentTag` references. Only the leaf
  references the note, exact managed UUIDs drive later migration and Trash cleanup, and same-title
  children under different parents remain distinct. Existing dotted/legacy AIC references migrate
  without touching shared or unrelated tags; duplicate or malformed candidates fail closed. A
  bridge without native nesting support falls back to the project tag only and never recreates a
  dotted pseudo-hierarchy.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Existing
`8.1.3` bindings migrate on their next successful writable sync. No Marketplace/Open VSX
publication is implied.

## 8.1.3 — 2026-08-21

Release sequence 8 · 1 feature outcome · 3 fixed-bug outcomes.

- F01: the pinned footer now has one confirmed two-sided **Move note to Trash** action. It targets
  only the exact bound Standard Notes UUID, moves that item to recoverable Trash, removes its
  AIC-managed tag reference, then trashes the local sidecar. Remote-first ordering, idempotent
  retries, and delayed binding cleanup prevent either side from being silently orphaned.
- B01: the Secondary note pane now uses the current Agents Window theme layers: an
  `agents.background` shell around an `agentsPanel.background` card with explicit border and
  foreground fallbacks, so notes remain visually separate from the editor across compatible themes.
- B02: raw Space is no longer captured as a task toggle. Typing `- [ ]` can now receive the
  required trailing space or task text and become a rendered checkbox; rendered checkbox clicks
  remain independently actionable.
- B03: empty/frontmatter-only notes, unchanged generated placeholders, and headings with only empty
  unchecked tasks are rejected before authentication or API access. Save, blur, and explicit sync
  therefore cannot create or overwrite remote content from a non-substantive scaffold.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Remote
Trash is recoverable Standard Notes state, never permanent deletion. No Marketplace/Open VSX
publication is implied.

## 7.3.2 — 2026-08-21

Release sequence 7 · 3 feature outcomes · 2 fixed-bug outcomes.

- F01: connected sidecars now synchronize after `Ctrl/Cmd+S`, attached-document saves, and
  Secondary editor blur. Per-note requests serialize and coalesce to the newest persisted body;
  automatic sync never prompts for credentials, and an in-flight remote pull cannot overwrite
  newer local edits.
- F02: fresh file notes now separate properties from an action-oriented `## Todo` and
  `## Open questions` seed, each with an empty checklist item. Workspace overrides and existing
  notes remain unchanged.
- F03: Secondary now follows every active source until pinned, presents a non-writing editable seed
  when its sidecar is absent, and creates the file on the first real edit. The crowded toolbar,
  manual Sync/Create/Docs controls, and auto-open checkbox are replaced by an icon-only footer;
  Source/Clear/Delete appear only while an existing note is pinned.
- B01: Standard Notes sync now assigns one dotted `<project>.<parent>.<child>` tag instead of three
  `aic`/`project:*`/`path:*` tags. Migration removes only AIC-owned references, retires empty legacy
  tags, records the exact new managed title, and preserves shared or unrelated user tags.
- B02: Open Linked Note now works outside editor text focus. Selection linking saves dirty sources,
  keeps the old chord as an alias, and adds layout-safe `Ctrl/Cmd+Alt+L` before opening the exact
  linked comment in Secondary.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. Automatic
sync remains sidecar-only and requires an already readable local session; manual recovery remains
available as **AIC Notes: Sync Current Note**. No Marketplace/Open VSX publication is implied.

## 6.6.1 — 2026-08-21

Release sequence 6 · 6 feature outcomes · 1 fixed-bug outcome.

- F01: Details now renders as one continuous sidebar-contrast card. Its title and real rotating SVG
  chevron toggle the exact marker, while checkbox, linked-source, and **Edit source** remain separate
  controls; read-only disclosure is visual only.
- F02: the Secondary toolbar is compact, wraps at narrow widths, uses the current note filename as
  its native title, and exposes a clickable parent-folder breadcrumb plus Pin/Unpin, Source, and Sync.
- F03: explicit **Log in/Log out** reflects the readable local encrypted session. Logout confirms and
  removes only that local vault, preserving the SecretStorage key, bindings, notes, and remote data.
- F04: **Edit source** is now the only source-entry action for Details, Mermaid, Table, and
  Properties; preview content clicks and synthetic container keyboard activation stay in preview.
- F05: a compact Note menu adds confirmed frontmatter-preserving **Clear content** and Trash-first
  local **Delete note**, without remote mutation.
- F06: install/update integrates the canonical AIC agent workflow. A committed thin
  `.vscode/aic-agent.json` marker travels with a project, while typed `aic rules` commands provide
  current English practice, context-file lifecycle, documentation/diagram rules, bounded waves,
  and the literal GO-to-DONE gate across agents and devices without duplicated prompt text.
- B01: redirected or otherwise closed `*.note.md` documents retain their URI and reopen before
  edit/save/sync/replace, eliminating the observed `Document has been closed` failure without
  leaving a Primary editor tab.

Compatibility: VS Code/Code 1.106 or newer; bundled Standard Notes bridge is Linux x64. AIC agent
workflow integration requires an independently installed compatible AIC executable. No
Marketplace/Open VSX publication is implied.

## 5.3.1 — 2026-08-21

Release sequence 5 · 3 feature outcomes · 1 fixed-bug outcome.

- F01: the Secondary note surface is always an editor, with no Preview/Edit switch; a Standard
  Notes item lock or read-only session makes that same surface fixed read-only until a later manual
  sync reports write access.
- F02: selection links now use the AIC `>>>|open| Title` / `>>> Title` / `<<<` details contract. A
  new block starts open with a checkbox and compact source link in its summary, the copied code
  fragment and comment inside, and an arrow that toggles only that block's exact marker.
- F03: a new file-note body is reduced to the existing frontmatter properties and one empty
  checklist item; project/folder defaults and valid workspace overrides remain intact.
- B01: Standard Notes authorization no longer depends on a desktop Secret Service/keyring. The Go
  bridge stores its session in an authenticated AES-256-GCM vault while VS Code SecretStorage holds
  the independent wrapping key, so headless code-server can connect without `secret-tool`.

Compatibility: VS Code/Code 1.106 or newer; the bundled Standard Notes bridge is Linux x64. The
first sync after upgrading from 4.3.3 requests a new connection because legacy keyring sessions are
not read, migrated, or deleted. No Marketplace/Open VSX publication is implied.

## 4.3.3 — 2026-08-21

Release sequence 4 · 3 feature outcomes · 3 fixed-bug outcomes.

- F01: a compact Secondary layout keeps controls and Markdown readable in the narrow pane while
  retaining the AIC visual contract.
- F02: following a source without a sidecar shows a non-writing placeholder with the candidate path
  and an explicit **Create note** action.
- F03: a saved source selection can add one deduplicated linked-code annotation to the canonical
  sidecar and navigate back to the exact lines without modifying source bytes; `*.ai.md` ownership
  is verified fail-closed.
- B01: Secondary Edit now reliably focuses the input, accepts changes, serializes overlapping
  updates, and saves through the VS Code document model.
- B02: toolbar labels and actions now use explicit theme-safe foreground fallbacks, so controls no
  longer disappear on dark side-bar themes.
- B03: the Standard Notes helper now sends the current mandatory client headers, validates server
  URLs, preserves MFA, and returns sanitized actionable connection categories instead of the
  unhelpful generic `sn_connect_failed` path where a safe classification exists.

Compatibility: VS Code/Code 1.106 or newer. Standard Notes sync remains Linux x64 only. Selection
links use persisted one-based line anchors. No Marketplace/Open VSX publication is implied.

## 3.4.0 — 2026-08-21

Release sequence 3 · 4 feature outcomes · 0 fixed-bug outcomes.

- F01: `.note.md` is Secondary-Side-Bar-only, with follow/pin, preview/edit, exact-tab
  interception, configurable `Ctrl/Cmd+Alt+N`, a workspace auto-open checkbox, and an ordinary-file
  note icon. The Primary Side Bar remains the existing-note manager.
- F02: ordinary Markdown and Secondary sidecars share the current Standard Notes AIC visual/editor
  contract while persisting exact Markdown only.
- F03: a manual Linux x64 MIT Go bridge performs encrypted Standard Notes sync with keychain-backed
  sessions, stable remote UUIDs, three-way comparison, and explicit conflict choice.
- F04: sync reconciles exact `aic`, `project:<root>`, and `path:<parent>` managed tag references while
  preserving every unrelated tag.

Compatibility: raises the extension-host floor to VS Code/Code 1.106. Standard Notes sync in this
release is Linux x64 only. No Marketplace/Open VSX publication is implied.

## 0.7.1 — 2026-07-06

- Fix: diagrams actually take the full available width — mermaid's inline
  `max-width` on the svg was overriding the full-bleed layout; zoom now
  scales from the true pane width.

## 0.7.0 — 2026-07-06

- Diagrams render full editor width (escaping the 76ch text column) with a
  hover zoom bar (50–400%, horizontal-scroll panning).
- Notes tree: the orphan warning now appears only when a note's frontmatter
  claims a `file-note`/`folder-note` target that is gone; free-standing notes
  show a plain icon.

## 0.6.0 — 2026-07-06

- Delete from the notes tree: per-note and per-folder (with the `.aic/notes`
  bucket), modal confirmation, trash-first.

## 0.5.2 — 2026-07-06

- Fix: table cells with a link or emphasis froze the editor (shared regex
  state across the recursive cell renderer); cell rendering extracted to a
  testable module with regression coverage.

## 0.5.0 / 0.5.1 — 2026-07-06

- Dark document typography: #E5E5E5 on #121212, 16px body at 1.6 line-height,
  76ch centered measure, bundled JetBrains Mono (OFL).
- Dark syntax highlighting for fenced code (replaces the light-palette
  default); headings by size + accent, underline reserved for links.
- Table cells render inline markdown (code/links/bold/italic/strike) and get
  their own cell backgrounds; `---` draws a real horizontal rule.
- Extension icon (the aic logo).

## 0.4.0 — 2026-07-06

- One-page mermaid preview: the live diagram renders inline below the fence
  while its source is edited (the separate preview tab is gone).

## 0.3.0 — 2026-07-05

- The editor claims every `*.md` (native editor reachable via Reopen With and
  a `Use Native Editor for Plain Markdown` command).
- Full aic reveal-rule session: headings, emphasis, inline code, clickable
  task checkboxes, list continue/renumber, link tooltip, blockquote/hr/
  strikethrough, nested fenced-code highlighting (lazy chunks).

## 0.2.0 — 2026-07-03

- Minimal note editor: live table grid, frontmatter props table, in-place
  mermaid; `*.note.md` only.

## 0.1.x — 2026-07-03

- Notes tree (global/project/bucket/per-directory), quick note creation with
  level templates, explorer nesting defaults.
