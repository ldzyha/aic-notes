# AIC Notes functional index

This is the release contract for the VS Code/code-server client. Every feature is
listed by owner, trigger, state boundary, side effect, failure behavior, and
automated coverage. A release is incomplete when a public command is missing
from this index or when an invariant below is not enforced by tests.

## Global invariants

- An ordinary `*.md` file is a **Document**. A `*.note.md` file is a linked or
  free-standing **Note** and is routed only to the Secondary Side Bar.
- Markdown is the sole persisted value. Preview widgets never keep a second
  data model and every mutation replaces one exact Markdown range.
- `Ctrl/Cmd+S` is the only note persistence and synchronization boundary.
  Input, focus, blur, tab changes, shutdown, and remote refresh never save.
- The active custom-editor tab is authoritative. A stale native text editor
  cannot keep the Secondary pane on an old file.
- Pinning affects only automatic following. Source and Trash capabilities are
  based on the current note and source, never on pin state.
- A fresh sidecar owns exactly `file`, `created`, and `updated`. A complete old
  seven-field generated signature is migrated on explicit save; authored
  properties survive.
- Missing Standard Notes authorization, an unreadable session, and unavailable
  secure storage are passive disconnected states during activation/background
  save. They never create error notifications or login prompts.
- Remote replacement is accepted only if the captured local document and its
  webview draft are still current. Two-sided divergence is never auto-merged.
- Remote deletion always targets a persisted UUID binding. There is no
  title-matched or guessed destructive operation.

## Surface and lifecycle matrix

| Surface / owner | Entry and behavior | Mutable state | Side effects / failure boundary | Coverage |
| --- | --- | --- | --- | --- |
| Extension activation (`src/extension.js`) | Registers all providers and commands; starts one quiet workspace reconciliation | explicit document-save set, in-flight pulled documents | Disconnected sync returns a state; only genuine operational failures notify | release contract, connection-state |
| Markdown editor (`src/editor/provider.js`) | Default custom editor for ordinary `*.md`; renders full AIC Markdown | VS Code `TextDocument`, selection snapshot | Edits are FIFO workspace edits; save stays owned by VS Code | release contract, preview suites |
| Note redirect (`src/secondary/provider.js`) | Intercepts an active `*.note.md` tab, routes it to Secondary, then closes only that exact tab | ordered navigation queue | Does not scan background tabs and never auto-pins | secondary-model, release contract |
| Secondary follow | Follows the authoritative active source while unpinned | document URI, source URI, placeholder URI, pin | Dirty draft blocks switching with status; ordered requests cannot finish out of order | secondary-model, draft-session |
| Secondary footer | Login/logout, Open source, Trash, Pin | auth, read-only, action-pending, pin | Source appears whenever an owner is known, including placeholders; Trash for an existing note; Pin for any surface | secondary-model, release contract |
| Notes & Documents tree (`src/notes/tree.js`) | Indexes every workspace `*.md`, labels Note/Document, and exposes lazy project/folder/file note entries | watched workspace inventory | Created/changed/deleted Markdown refreshes the tree; invisible/private notes are filtered | paths, frontmatter, release contract |
| Lazy placeholder (`src/notes/create.js`) | Maps source/folder/project to a canonical sidecar without writing it | generated Markdown draft | Only explicit save creates the file; fresh managed frontmatter has exactly three fields even when an old custom template contains frontmatter | templates, file-properties, sync-admission |
| Linked source comment (`src/notes/selection.js`) | Adds one deduplicated details block for the exact selected characters/lines | source selection and owner note | Dirty source is saved before anchoring; source itself is never edited | selection-model, release contract |
| Standard Notes service (`src/sync/client.js`) | Auth, full project import, inventory reconcile, three-way note sync, Trash | encrypted session, local UUID/base/tag bindings | Passive disconnection is quiet; ambiguity/read-only/conflict fails closed | import, admission, queue, Go bridge tests |
| Agent workflow (`src/agents/bootstrap.js`) | Writes a thin project marker and invokes typed AIC rules commands | marker and activation version | Untrusted workspaces and owner-managed global instructions fail closed | agent-contract, release contract |

## Markdown interaction index

| Feature | Preview interaction | Edit interaction | Copy / navigation | Read-only behavior |
| --- | --- | --- | --- | --- |
| Headings, emphasis, strike, quote, HR | Rendered in place | Cursor/selection reveals exact source | Native selection | Source can be revealed but not changed |
| Lists and tasks | Task checkbox toggles the Markdown marker | Space completes task syntax; normal text editing | Native selection | Checkbox and edits disabled |
| Links and wiki links | Label opens the resolved target | Always-visible Edit icon reveals source | Always-visible Copy icon; external schemes are allow-listed | Open and Copy remain available |
| Details / linked code | Chevron or summary toggles; checkbox remains independently clickable | Comment stays inside the expanded body | Source label returns to exact lines; Copy is always visible | Disclosure, open, and copy remain available |
| Fenced code | Highlighted preview for known languages | Edit icon reveals the complete fence | Copy icon copies exact fence body | Copy remains available |
| Mermaid | Rendered diagram with zoom, reset, rotate | Edit icon reveals the fence | Copy copies Mermaid source; viewport scrolls on both axes | View controls and copy remain available |
| Tables | Content-sized, word-boundary columns in a dedicated horizontal scroller | One transient textarea popover; add/reorder row/column | Copy icon copies the exact table source | Select/copy/scroll remain available |
| Frontmatter properties | Nested, read-only preview below the managed three fields; relationship tree follows frontmatter | One transient textarea popover; add/reorder valid sibling branches | Values remain selectable | Preview remains visible; edit actions disabled |
| Selection | Collapsed cursor retains preview | Non-empty selection reveals intersected source; `Ctrl/Cmd+A` reveals all | Native copy | Same reveal contract |

## Commands

| Command | Scope and contract |
| --- | --- |
| `aicNotes.noteForCurrentFile` | Open the canonical linked note/placeholder for the authoritative active tab |
| `aicNotes.linkSelectionToNote` | Link the exact non-empty source selection into its canonical owner note |
| `aicNotes.syncCurrentNote` | Explicit recovery sync; may request login/conflict resolution |
| `aicNotes.pullProjectNotes` | Explicit full tagged-project pull and reconciliation |
| `aicNotes.openInSecondary` | Internal/public Secondary routing boundary for `*.note.md` |
| `aicNotes.noteForExplorerItem` | Open a file, folder, or workspace-root placeholder from Explorer |
| `aicNotes.openProjectNote` | Open the selected/current workspace root note placeholder |
| `aicNotes.refreshTree` | Re-index the Notes & Documents tree |
| `aicNotes.enableExplorerNesting` | Apply supported Explorer sidecar nesting settings |
| `aicNotes.openTarget` | Resolve a tree note to its existing source/folder |
| `aicNotes.copyWikiLink` | Copy the selected note's project-relative wiki link |
| `aicNotes.useNativeForMarkdown` | Restore native editor association for ordinary Markdown only |
| `aicNotes.deleteNote` | Confirm and Trash one exact note, remote-bound side first |
| `aicNotes.deleteFolderNotes` | Confirm and Trash the indexed notes under one tree folder |
| `aicNotes.enableAgentWorkflow` | Add the portable AIC marker to a trusted project |
| `aicNotes.syncAgentInstructions` | Explicitly verify/synchronize the installed AIC rules contract |
| `aicNotes.openNote` | Internal tree routing alias that preserves the Secondary-only rule |

## Save and synchronization state machine

1. Input changes only the in-memory CodeMirror/VS Code draft and marks it dirty.
2. A note switch is accepted only when the draft is clean; otherwise the
   current note remains visible and the status requests `Ctrl/Cmd+S`.
3. Explicit save stamps the three managed properties and persists the complete
   latest draft once.
4. Empty/generated scaffolds stop before Standard Notes API access.
5. A disconnected session returns `disconnected` and leaves the local save
   successful without a toast.
6. A connected request compares local, remote, and last common base. A
   one-sided change propagates; a two-sided change requires an explicit choice.
7. A result that became stale during the request advances no visible draft;
   the newer local text remains dirty for the next save.

## Release verification matrix

- Pure models: paths, selection ownership/ranges, details markers, table and
  property operations, navigation queue, drafts, admission, import identity.
- Client integration: command registration, provider wiring, webview protocol,
  Windows in-process WASM, Linux helper packaging, disconnected state.
- Native core: Go authentication classification, encryption/session payloads,
  locked/read-only behavior, import/tag graph, deterministic identities.
- UI: standalone renderer interaction in a browser and installed VS Code
  verification for note following, pin/unpin, persistent actions, placeholder,
  explicit-save state, and quiet disconnected operation.
- Distribution: both platform VSIX archives, SHA-256 assets, shared-core
  provenance, release tag/version parity, and GitHub release pipelines.
