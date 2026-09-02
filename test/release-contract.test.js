import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("21.0.1 manifest separates Primary management from Secondary note content", () => {
  assert.equal(packageJson.version, "21.0.1");
  assert.equal(packageJson.aicEditorCore, "2.7.0");
  assert.equal(packageJson.engines.vscode, "^1.106.0");
  assert.equal(packageJson.scripts.publish, undefined);
  assert.ok(packageJson.scripts["release:gate"]);
  assert.ok(
    packageJson.contributes.views.aicNotes.some(
      (view) => view.id === "aicNotes.tree",
    ),
  );
  assert.ok(
    packageJson.contributes.viewsContainers.secondarySidebar.some(
      (container) => container.id === "aicNotesSecondary",
    ),
  );
  assert.ok(
    packageJson.contributes.views.aicNotesSecondary.some(
      (view) => view.id === "aicNotes.secondary" && view.type === "webview",
    ),
  );
});

test("note association, linked-note hotkey, and footer surface are explicit", async () => {
  assert.equal(
    packageJson.contributes.configurationDefaults[
      "workbench.editorAssociations"
    ]["*.note.md"],
    "aicNotes.noteRedirect",
  );
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac },
    { key: "ctrl+alt+n", mac: "cmd+alt+n" },
  );
  assert.equal(binding.when, undefined);
  const titleItem = packageJson.contributes.menus["editor/title"].find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.match(titleItem.when, /not =~ \/\\\.note\\\.md\$\//u);
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const create = await readFile(
    new URL("../src/notes/create.js", import.meta.url),
    "utf8",
  );
  const extension = await readFile(
    new URL("../src/extension.js", import.meta.url),
    "utf8",
  );
  const target = await readFile(
    new URL("../src/notes/target.js", import.meta.url),
    "utf8",
  );
  const tree = await readFile(
    new URL("../src/notes/tree.js", import.meta.url),
    "utf8",
  );
  assert.match(provider, /id="secondary-footer"/u);
  assert.match(provider, /id="pane-pin"/u);
  assert.match(provider, /id="pane-clear"/u);
  assert.doesNotMatch(provider, /id="pane-delete"/u);
  assert.doesNotMatch(provider, /id="pane-(?:auto|sync|create|note-actions)"/u);
  assert.match(provider, /tabGroups\.close/u);
  assert.match(provider, /new NavigationQueue\(\)/u);
  assert.match(
    provider,
    /activeResource\(\s*activeTabUri,\s*activeEditorUri,\s*Boolean\(activeTab\),\s*\)/u,
  );
  assert.match(provider, /routeActiveNoteTab/u);
  assert.doesNotMatch(provider, /routeNoteTabs|routingTabs|pin: true/u);
  assert.match(provider, /preferredWorkspaceFolder/u);
  assert.match(provider, /this\.followTarget\(folder\.uri, \{ preserveFocus: true \}\)/u);
  assert.match(
    create,
    /secondary\.followSource\(uri, \{ force: true, preserveFocus: false \}\)/u,
  );
  assert.match(
    create,
    /secondary\.followTarget\(uri, \{ force: true, preserveFocus: false \}\)/u,
  );
  assert.doesNotMatch(create, /openGlobalNote|GLOBAL_NOTE_PATH/u);
  assert.ok(
    !packageJson.contributes.commands.some(
      ({ command }) => command === "aicNotes.openGlobalNote",
    ),
  );
  assert.doesNotMatch(create, /ensureFileNoteForUri/u);
  assert.match(create, /freshNoteText/u);
  assert.match(create, /stampFileProperties/u);
  assert.doesNotMatch(create, /noteMeta|stringifyFrontmatter/u);
  assert.match(extension, /noteForCurrentFile\(secondary\)/u);
  assert.match(target, /relNotePath === `\$\{folder\.name\}\.note\.md`/u);
  assert.match(tree, /projectPlaceholder/u);
  assert.match(tree, /Project note/u);
  assert.doesNotMatch(tree, /global note|GLOBAL_NOTE_PATH/u);
});

test("source selections expose the AIC linked-comment action without targeting note files", async () => {
  const binding = packageJson.contributes.keybindings.find(
    ({ command, key }) =>
      command === "aicNotes.linkSelectionToNote" && key === "ctrl+alt+l",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac },
    { key: "ctrl+alt+l", mac: "cmd+alt+l" },
  );
  assert.ok(
    packageJson.contributes.keybindings.some(
      ({ command, key, mac }) =>
        command === "aicNotes.linkSelectionToNote" &&
        key === "ctrl+shift+/" &&
        mac === "cmd+shift+/",
    ),
  );
  assert.match(binding.when, /editorHasSelection/u);
  assert.match(binding.when, /not =~ \/\\\.note\\\.md\$\//u);
  const menu = packageJson.contributes.menus["editor/context"].find(
    ({ command }) => command === "aicNotes.linkSelectionToNote",
  );
  assert.match(menu.when, /editorHasSelection/u);
  const selection = await readFile(
    new URL("../src/notes/selection.js", import.meta.url),
    "utf8",
  );
  assert.match(selection, /document\.isDirty/u);
  assert.match(selection, /await document\.save\(\)/u);
  assert.match(selection, /document\.getText\(editor\.selection\)/u);
  assert.match(selection, /secondary\.open[\s\S]*selection:/u);
  assert.match(selection, /activeSourceSelection/u);
  assert.doesNotMatch(selection, /mode: "(?:edit|preview)"/u);
  assert.doesNotMatch(selection, /edit\.replace\(document\.uri/u);
});

test("custom Markdown selections cross the webview boundary for linked comments", async () => {
  const provider = await readFile(
    new URL("../src/editor/provider.js", import.meta.url),
    "utf8",
  );
  const webview = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  const extension = await readFile(
    new URL("../src/extension.js", import.meta.url),
    "utf8",
  );
  assert.match(provider, /async activeSourceSelection\(\)/u);
  assert.match(provider, /messageQueue = messageQueue\.then/u);
  assert.match(provider, /finally \{[\s\S]*state\.applying--/u);
  assert.match(provider, /type: "selection\.request"/u);
  assert.match(provider, /case "selection\.snapshot"/u);
  assert.match(webview, /case "selection\.request"/u);
  assert.match(webview, /type: "selection\.snapshot"/u);
  assert.match(webview, /type: "selection", anchor, head/u);
  assert.match(webview, /type: "selection\.link", anchor, head/u);
  assert.match(provider, /case "selection\.link"/u);
  assert.match(extension, /linkSelectionToNote\(secondary, markdownEditor\)/u);
});

test("Secondary editable placeholder, explicit save, and theme-safe controls are scoped", async () => {
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const webview = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  const details = await readFile(
    new URL("../src/webview/details.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/webview/theme.css", import.meta.url),
    "utf8",
  );
  assert.match(provider, /notePlaceholderForUri/u);
  assert.match(provider, /async followTarget/u);
  assert.doesNotMatch(provider, /createFromPlaceholder|async applyChanges|case "edit"/u);
  assert.match(provider, /case "commit"[\s\S]*commitDraft/u);
  assert.match(provider, /workspace\.fs\.writeFile/u);
  assert.match(provider, /id="pane-breadcrumb"/u);
  assert.match(provider, /id="pane-filename"/u);
  assert.match(provider, /id="pane-auth"/u);
  assert.match(provider, /data-aic-icon="login"/u);
  assert.match(provider, /data-aic-icon="trash"/u);
  assert.match(provider, /data-aic-icon="pin"/u);
  assert.doesNotMatch(provider, /<svg/u);
  assert.doesNotMatch(provider, /class="aic-pane-icon[^\n]*title=/u);
  assert.match(provider, /Standard Notes · Connected/u);
  assert.match(provider, /Standard Notes · Disconnected/u);
  assert.match(provider, /paneCapabilities/u);
  assert.match(provider, /canOpenTarget: capabilities\.canOpenTarget/u);
  assert.match(provider, /canTrash: capabilities\.canTrash/u);
  assert.match(provider, /async openCurrentTarget\(\)/u);
  assert.match(provider, /executeCommand\("revealInExplorer", target\)/u);
  assert.doesNotMatch(provider, /showPinnedActions/u);
  assert.match(webview, /target\.hidden = !msg\.canOpenTarget/u);
  assert.match(webview, /clear\.hidden = !msg\.canTrash/u);
  assert.doesNotMatch(provider, /onDidSaveTextDocument/u);
  assert.doesNotMatch(provider, /onDocumentSaved/u);
  assert.match(provider, /CoalescingQueue/u);
  assert.match(
    provider,
    /case "ready":[\s\S]*else await this\.followActive\(\)/u,
  );
  assert.doesNotMatch(webview, /commitDraft\("blur"\)|onfocusout/u);
  assert.match(webview, /commitDraft\("explicit"\)/u);
  assert.match(webview, /dataset\.saveState/u);
  assert.match(webview, /dataset\.aicIcon = msg\.authConnected/u);
  assert.match(provider, /Unsaved · Ctrl\+S/u);
  assert.match(webview, /DraftSession/u);
  assert.match(webview, /type: "draft\.state"/u);
  assert.match(provider, /newerWebviewDraft/u);
  assert.doesNotMatch(webview, /secondarySurface\) postEdit\(update\)/u);
  assert.match(webview, /EditorState\.readOnly\.of\(docState\.readOnly\)/u);
  assert.match(
    webview,
    /if \(!docState\.readOnly\) requestAnimationFrame\(\(\) => view\?\.focus\(\)\)/u,
  );
  assert.doesNotMatch(webview, /pane\.(?:create|sync|autoOpen|reveal)/u);
  assert.doesNotMatch(
    webview,
    /@codemirror\/search|searchKeymap|search\(\{ top:/u,
  );
  assert.doesNotMatch(provider, /case "pane\.sync"/u);
  assert.doesNotMatch(provider, /pane-mode/u);
  assert.doesNotMatch(webview, /paneMode|setPaneMode/u);
  assert.match(details, /EditorView\.decorations\.from\(field\)/u);
  assert.doesNotMatch(details, /ViewPlugin/u);
  assert.match(css, /--aic-contrast-fg:[^;]*--vscode-foreground/u);
  assert.match(css, /--aic-agent-shell:[^;]*--vscode-agents-background/u);
  assert.match(
    css,
    /--aic-agent-panel:[^;]*--vscode-agentsPanel-background[^;]*--vscode-sideBar-background/u,
  );
  assert.match(
    css,
    /--aic-agent-panel-border:[^;]*--vscode-agentsPanel-border[^;]*--vscode-sideBar-border/u,
  );
  assert.match(css, /html\.aic-secondary-shell/u);
  assert.match(css, /body\.aic-secondary-surface/u);
  assert.match(css, /margin: 5px/u);
  assert.match(
    css,
    /\.aic-secondary-surface \.cm-editor \{ font-size: 0\.875rem; \}/u,
  );
  assert.match(
    css,
    /\.aic-secondary-surface \.cm-scroller \{ line-height: 1\.42; \}/u,
  );
  assert.match(css, /#secondary-footer/u);
  assert.match(css, /\.cm-aic-details-summary/u);
  assert.match(css, /--aic-details-surface:/u);
  assert.doesNotMatch(details, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/u);
  assert.match(details, /dataset\.aicIcon = "chevron"/u);
  assert.match(details, /createIconButton/u);
  assert.doesNotMatch(details, /[▸▾]/u);
});

test("headless authorization uses SecretStorage plus the encrypted bridge vault", async () => {
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const vault = await readFile(
    new URL("../src/sync/vault.js", import.meta.url),
    "utf8",
  );
  const bridge = await readFile(
    new URL("../bridge/main.go", import.meta.url),
    "utf8",
  );
  assert.match(client, /sessionVaultConfig/u);
  assert.match(vault, /context\.secrets\.store/u);
  assert.match(vault, /const confirmed = await context\.secrets\.get/u);
  assert.match(
    vault,
    /confirmed === candidate \? candidate : await fileBackedVaultKey/u,
  );
  assert.match(vault, /vaultKeyCache/u);
  assert.match(vault, /standard-notes-session\.v1\.json/u);
  assert.match(vault, /fileBackedVaultKey/u);
  assert.match(vault, /standard-notes-vault-key\.v1/u);
  assert.match(vault, /open\(keyPath, "wx", 0o600\)/u);
  assert.match(vault, /context\.globalStoragePath/u);
  assert.match(vault, /vscode\.Uri\.file\(context\.globalStoragePath\)/u);
  assert.doesNotMatch(bridge, /session\.UpdateSession/u);
  assert.doesNotMatch(bridge, /session\.GetSessionFromKeyring/u);
  assert.match(bridge, /ReadOnly/u);
  assert.match(bridge, /case "disconnect"/u);
  assert.match(client, /async logout\(\)/u);
});

test("background sync treats missing authorization as a quiet state", async () => {
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const connection = await readFile(
    new URL("../src/sync/connection-state.js", import.meta.url),
    "utf8",
  );
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const extension = await readFile(
    new URL("../src/extension.js", import.meta.url),
    "utf8",
  );
  assert.match(connection, /sn_not_connected/u);
  assert.match(connection, /sn_vault_unavailable/u);
  assert.match(connection, /sn_vault_unreadable/u);
  assert.match(client, /passiveConnectionState\(error\)/u);
  assert.match(client, /disconnectedSyncResult\(error\)/u);
  assert.match(provider, /if \(passive\)[\s\S]*return false/u);
  assert.match(extension, /if \(passiveConnectionState\(error\)\) return/u);
});

test("first login and explicit recovery pull only tagged project notes", async () => {
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const bridge = await readFile(
    new URL("../bridge/main.go", import.meta.url),
    "utf8",
  );
  const importer = await readFile(
    new URL("../bridge/import.go", import.meta.url),
    "utf8",
  );
  assert.ok(
    packageJson.contributes.commands.some(
      ({ command }) => command === "aicNotes.pullProjectNotes",
    ),
  );
  assert.match(provider, /login\(\)[\s\S]*importProjectNotes/u);
  assert.match(client, /operation: "pull-project"/u);
  assert.match(client, /await chmod\(bridge, 0o755\)/u);
  assert.doesNotMatch(client, /existing !== candidate\.remote\.localContent/u);
  assert.match(client, /persist the binding\/base/u);
  assert.match(bridge, /discoverRemoteNote/u);
  assert.match(bridge, /case "pull-project"/u);
  assert.match(importer, /projectTagAssignments/u);
  assert.match(importer, /project:/u);
  assert.match(importer, /path:/u);
});

test("Secondary installs its message receiver before loading webview HTML", async () => {
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const receiver = provider.indexOf("view.webview.onDidReceiveMessage");
  const html = provider.indexOf("view.webview.html = webviewHtml");
  assert.ok(receiver >= 0 && html >= 0 && receiver < html);
});

test("Secondary recovers a missing sidecar as a placeholder and keeps failed saves local", async () => {
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  assert.match(
    provider,
    /if \(!\(await exists\(uri\)\)\)[\s\S]*notePlaceholderForUri\(target\)/u,
  );
  assert.match(
    provider,
    /if \(this\.documentUri && !\(await exists\(this\.documentUri\)\)\)/u,
  );
  assert.match(
    provider,
    /await vscode\.workspace\.fs\.writeFile\(this\.documentUri/u,
  );
  assert.match(
    provider,
    /let saved = false;[\s\S]*saved = await document\.save\(\)/u,
  );
  assert.match(provider, /Save failed · draft kept in the editor/u);
});

test("code, Mermaid, and link actions copy through the VS Code clipboard bridge", async () => {
  const code = await readFile(
    new URL("../vendor/markdown/handlers/code-fence.js", import.meta.url),
    "utf8",
  );
  const mermaid = await readFile(
    new URL("../vendor/markdown/mermaid.js", import.meta.url),
    "utf8",
  );
  const link = await readFile(
    new URL("../vendor/markdown/link-actions.js", import.meta.url),
    "utf8",
  );
  const editor = await readFile(
    new URL("../src/editor/provider.js", import.meta.url),
    "utf8",
  );
  const secondary = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const main = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  const viewport = await readFile(
    new URL(
      "../vendor/aic-editor-core/mermaid-viewport.js",
      import.meta.url,
    ),
    "utf8",
  );
  const viewportCss = await readFile(
    new URL(
      "../vendor/aic-editor-core/mermaid-viewport.css",
      import.meta.url,
    ),
    "utf8",
  );
  const details = await readFile(
    new URL("../src/webview/details.js", import.meta.url),
    "utf8",
  );
  assert.match(code, /cm-md-code-preview cm-md-block-preview/u);
  assert.match(code, /label: "Copy code"/u);
  assert.match(code, /icon: "copy"/u);
  assert.doesNotMatch(code, /copy\.textContent/u);
  assert.match(code, /clipboard\.write/u);
  assert.match(mermaid, /label: "Copy Mermaid source"/u);
  assert.doesNotMatch(mermaid, /copy\.textContent/u);
  assert.match(mermaid, /clipboard\.write/u);
  assert.match(link, /makeLinkActionsExtension/u);
  assert.match(link, /createLinkControl/u);
  assert.match(link, /label: "link URL"/u);
  assert.match(link, /clipboard\.write/u);
  assert.match(editor, /vscode\.env\.clipboard\.writeText/u);
  assert.match(secondary, /vscode\.env\.clipboard\.writeText/u);
  assert.match(main, /makeCodeFenceExtension\(host\)/u);
  assert.match(main, /makeMermaidExtension\(host\)/u);
  assert.match(main, /MERMAID_VIEWPORT_CSS/u);
  assert.match(mermaid, /createMermaidViewport/u);
  assert.match(viewport, /Rotate diagram 90° clockwise/u);
  assert.match(viewport, /boundsHeight = sideways/u);
  assert.match(viewportCss, /\.cm-aic-mermaid-viewport[\s\S]*overflow: auto/u);
  assert.match(viewportCss, /--aic-mermaid-rotation/u);
  assert.doesNotMatch(details, /inertPreviewClicks/u);
  assert.match(details, /ignoreEvent\(\) \{[\s\S]*return true/u);
});

test("table preview uses transient cell editors and a dedicated horizontal scroller", async () => {
  const table = await readFile(
    new URL("../vendor/markdown/handlers/table.js", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../vendor/markdown/styles.js", import.meta.url),
    "utf8",
  );
  const main = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  const core = await readFile(
    new URL("../vendor/aic-editor-core/structured-preview.js", import.meta.url),
    "utf8",
  );
  assert.match(table, /createCellEditor/u);
  assert.doesNotMatch(table, /createElement\("textarea"\)/u);
  assert.match(core, /className = "cm-aic-cell-popover"/u);
  assert.match(core, /document\.createElement\("textarea"\)/u);
  assert.match(table, /cm-aic-table-scroll/u);
  assert.match(table, /label: "Markdown table"/u);
  assert.match(table, /"Copy table", "copy"/u);
  assert.match(table, /makeTableExtension\(host\)/u);
  assert.match(styles, /width: max-content; min-width: 100%/u);
  assert.match(styles, /word-break: normal/u);
  assert.match(styles, /\.cm-aic-cell-popover/u);
  assert.match(main, /wirePreviewSelection/u);
  assert.match(main, /userEvent: "select\.pointer"/u);
});

test("all preview actions use renderer-independent CSS SVG masks", async () => {
  const icons = await readFile(
    new URL("../vendor/aic-editor-core/icons.css", import.meta.url),
    "utf8",
  );
  const core = await readFile(
    new URL("../vendor/aic-editor-core/structured-preview.js", import.meta.url),
    "utf8",
  );
  const main = await readFile(
    new URL("../src/webview/main.js", import.meta.url),
    "utf8",
  );
  assert.match(icons, /data:image\/svg\+xml/u);
  assert.match(icons, /-webkit-mask: var\(--aic-icon\)/u);
  assert.match(icons, /mask: var\(--aic-icon\)/u);
  assert.match(core, /dataset\.aicIcon/u);
  assert.match(core, /setAttribute\("aria-label"/u);
  assert.match(main, /ICONS_CSS/u);
});

test("release gate hashes CI-built VSIX files before publishing all assets", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /contents: write/u);
  assert.match(workflow, /npm run package:windows[\s\S]*sha256sum/u);
  assert.match(workflow, /sha256sum[\s\S]*npm run release:verify/u);
  assert.match(workflow, /gh release create/u);
  assert.match(workflow, /group: release-\$\{\{ github\.ref \}\}/u);
  assert.match(workflow, /gh release view "\$GITHUB_REF_NAME"/u);
  assert.match(workflow, /gh release upload[\s\S]*--clobber/u);
  assert.match(workflow, /linux-x64\.vsix\.sha256/u);
  assert.match(workflow, /win32-x64\.vsix\.sha256/u);
});

test("workspace initialization reconciles all Markdown and properties expose read-only note context", async () => {
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const relationships = await readFile(
    new URL("../src/notes/relationships.js", import.meta.url),
    "utf8",
  );
  const frontmatter = await readFile(
    new URL("../vendor/markdown/handlers/frontmatter.js", import.meta.url),
    "utf8",
  );
  assert.match(client, /async reconcileOpenWorkspaces/u);
  assert.match(client, /importOpenWorkspaces\(\{ showProgress: false \}\)/u);
  assert.match(client, /workspace\.findFiles\([\s\S]*\*\*\/\*\.md/u);
  assert.match(client, /markdownKind\(uri\.path\) === "note"/u);
  assert.match(client, /resolveConflicts: false/u);
  const reconcile = client.slice(
    client.indexOf("async reconcileOpenWorkspaces"),
    client.indexOf("async _connect"),
  );
  assert.match(
    reconcile,
    /acceptResult: async \(candidate\)[\s\S]*openDocument\?\.isDirty[\s\S]*workspace\.fs\.writeFile/u,
  );
  const syncMethod = client.slice(client.lastIndexOf("async sync("));
  assert.ok(
    syncMethod.indexOf("workspaceState.update") <
      syncMethod.indexOf("await acceptResult(result)"),
  );
  assert.match(provider, /initializeWorkspaceSync/u);
  assert.match(provider, /noteRelationshipsForTarget/u);
  assert.match(provider, /createFileSystemWatcher\("\*\*\/\*\.note\.md"\)/u);
  assert.match(provider, /async refreshRelationships/u);
  assert.match(provider, /type: "relationships"/u);
  assert.match(relationships, /relation,\s*label:[\s\S]*exists:/u);
  assert.match(frontmatter, /setNoteRelationships/u);
  assert.match(frontmatter, /wrapper\.append\(relationships\)/u);
  assert.match(frontmatter, /host\.bus\.publish\("note\.open"/u);
  assert.doesNotMatch(frontmatter, /contenteditable/iu);
});

test("documents and notes stay visibly distinct and ordinary Ctrl+S synchronizes", async () => {
  const extension = await readFile(
    new URL("../src/extension.js", import.meta.url),
    "utf8",
  );
  const tree = await readFile(
    new URL("../src/notes/tree.js", import.meta.url),
    "utf8",
  );
  const styles = await readFile(
    new URL("../vendor/markdown/styles.js", import.meta.url),
    "utf8",
  );
  assert.match(extension, /onDidSaveTextDocument/u);
  assert.match(extension, /onWillSaveTextDocument/u);
  assert.match(extension, /TextDocumentSaveReason\.Manual/u);
  assert.match(extension, /stampFileProperties/u);
  assert.match(
    extension,
    /event\.waitUntil\(legacyPropertyCleanupEdits\(event\.document\)\)/u,
  );
  assert.match(extension, /explicitDocumentSaves\.delete/u);
  assert.match(extension, /endsWith\("\.note\.md"\)/u);
  assert.match(
    extension,
    /sync\.sync\(document\.uri, captured, \{[\s\S]*?interactive: false,[\s\S]*?resolveConflicts: true,[\s\S]*?acceptResult: async \(candidate\)/u,
  );
  assert.match(extension, /applyingDocumentPulls/u);
  assert.match(
    extension,
    /workspace\.applyEdit\(edit\)[\s\S]*document\.save\(\)/u,
  );
  assert.match(tree, /createFileSystemWatcher\("\*\*\/\*\.md"\)/u);
  assert.match(tree, /item\.description = "Document"/u);
  assert.match(tree, /element\.forcedLevel === "project"/u);
  assert.match(
    styles,
    /\.cm-aic-link-actions \{ display: inline-flex; gap: \.15rem \}/u,
  );
  assert.doesNotMatch(styles, /\.cm-aic-link-actions[^}]*opacity:\s*0/u);
});

test("Standard Notes tags use a native parent graph and exact managed identities", async () => {
  const model = await readFile(
    new URL("../src/secondary/model.js", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const bridge = await readFile(
    new URL("../bridge/main.go", import.meta.url),
    "utf8",
  );
  assert.match(
    model,
    /supportsNestedTags \? \[project, \.\.\.parents\] : \[project\]/u,
  );
  assert.doesNotMatch(model, /join\("\."\)/u);
  assert.match(client, /previousTagUuids/u);
  assert.match(client, /managedTagUuids/u);
  assert.match(bridge, /tagToParentReferenceType\s+= "TagToParentTag"/u);
  assert.match(bridge, /ReferenceType:\s+tagToParentReferenceType/u);
  assert.match(bridge, /leafUUID/u);
  assert.match(bridge, /PreviousTagUUIDs/u);
  assert.match(bridge, /ManagedTagUUIDs/u);
  assert.match(bridge, /noteHasActiveTagReference/u);
  assert.match(bridge, /Action:\s+"identity-conflict"/u);
  assert.match(bridge, /discoverRemoteIdentity/u);
  assert.match(client, /Resolve duplicate Standard Notes identity/u);
  assert.match(client, /remoteUuid: selected\.remoteUuid/u);
  assert.match(client, /resolution: selected\.resolution/u);
});

test("Secondary rejects non-substantive sync before API access and exposes one two-sided Trash action", async () => {
  const provider = await readFile(
    new URL("../src/secondary/provider.js", import.meta.url),
    "utf8",
  );
  const admission = await readFile(
    new URL("../src/sync/admission.js", import.meta.url),
    "utf8",
  );
  const client = await readFile(
    new URL("../src/sync/client.js", import.meta.url),
    "utf8",
  );
  const bridge = await readFile(
    new URL("../bridge/main.go", import.meta.url),
    "utf8",
  );
  const deletion = await readFile(
    new URL("../src/notes/delete.js", import.meta.url),
    "utf8",
  );
  assert.match(provider, /this\.documentUri/u);
  assert.match(provider, /this\.document\.isClosed/u);
  assert.match(provider, /workspace\.openTextDocument\(uri\)/u);
  assert.match(provider, /async recoverPlaceholder\(uri/u);
  assert.match(provider, /if \(!\(await exists\(uri\)\)\) \{/u);
  const open = provider.slice(
    provider.indexOf("async openNow(uri"),
    provider.indexOf("async recoverPlaceholder"),
  );
  assert.match(open, /finishNoteRouting\(uri, reveal\)/u);
  const routing = provider.slice(
    provider.indexOf("async finishNoteRouting"),
    provider.indexOf("async recoverPlaceholder"),
  );
  assert.ok(
    routing.indexOf("closeExactNoteTabs(uri)") <
      routing.indexOf("focus(false)"),
  );
  const performSync = provider.slice(
    provider.indexOf("async performSync"),
    provider.indexOf("async saveCurrent"),
  );
  assert.ok(
    performSync.indexOf("syncAdmission") <
      performSync.indexOf("this.syncService.sync"),
  );
  assert.match(admission, /reason: "empty"/u);
  assert.match(admission, /reason: "placeholder"/u);
  assert.match(provider, /trashCurrentNote/u);
  assert.match(provider, /this\.syncService\.trash\(uri\)/u);
  assert.match(provider, /trashNotesLocally\(\[uri\]\)/u);
  assert.match(provider, /this\.syncService\.completeTrash\(uri\)/u);
  assert.doesNotMatch(provider, /clearNoteContent/u);
  assert.match(client, /operation: "trash"/u);
  assert.match(client, /remoteUuid: previous\.remoteUuid/u);
  assert.match(
    client,
    /workspaceState\.update\(workspaceStateKey\(uri\), undefined\)/u,
  );
  assert.match(bridge, /case "trash"/u);
  assert.match(bridge, /remote\.Content\.SetTrashed\(true\)/u);
  assert.match(bridge, /note\.UUID == input\.RemoteUUID/u);
  assert.match(
    deletion,
    /trashNotesLocally\([\s\S]*\{ beforeDelete, afterDelete, detail = "" \} = \{\}/u,
  );
  assert.match(deletion, /await afterDelete\?\.\(uri\)/u);
  assert.match(deletion, /useTrash: true/u);
  assert.match(deletion, /"Delete Permanently"/u);
});

test("portable agent workflow uses only a thin .vscode marker and typed AIC commands", async () => {
  const contract = await readFile(
    new URL("../src/agents/contract.js", import.meta.url),
    "utf8",
  );
  const bootstrap = await readFile(
    new URL("../src/agents/bootstrap.js", import.meta.url),
    "utf8",
  );
  assert.match(contract, /\["\.vscode", "aic-agent\.json"\]/u);
  assert.match(contract, /guideCommand: "aic guide --json"/u);
  assert.match(contract, /ownerNotes: "\*\.note\.md"/u);
  assert.match(contract, /taskArtifacts: "\*\.ai\.md"/u);
  assert.doesNotMatch(contract, /instructionPack|English practice/u);
  assert.match(bootstrap, /\["rules", "status", "--json"\]/u);
  assert.match(bootstrap, /\["rules", "sync", "--json"\]/u);
  assert.match(bootstrap, /workspace\.isTrusted/u);
  assert.doesNotMatch(bootstrap, /AGENTS\.md.*writeFile|\.aic\//u);
});

test("release packaging includes the helper but excludes helper source", async () => {
  const ignore = await readFile(
    new URL("../.vscodeignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /^bridge\/\*\*$/mu);
  assert.match(ignore, /^\*\.vsix\.sha256$/mu);
  assert.match(ignore, /^bin\/\*\*$/mu);
  assert.match(ignore, /^!bin\/linux-x64\/aic-notes-sn-bridge$/mu);
  assert.match(ignore, /^!bin\/wasm\/aic-notes-sn-bridge\.wasm$/mu);
  assert.match(ignore, /^!bin\/wasm\/wasm_exec\.js$/mu);
  assert.doesNotMatch(
    ignore,
    /^!bin\/windows-x64\/aic-notes-sn-bridge\.exe$/mu,
  );
  assert.ok(packageJson.scripts["package:windows"]);
  const goMod = await readFile(
    new URL("../bridge/go.mod", import.meta.url),
    "utf8",
  );
  assert.match(goMod, /28e3820a341f/u);
  const provenance = await readFile(
    new URL("../PROVENANCE.md", import.meta.url),
    "utf8",
  );
  assert.match(provenance, /cdeac5fac8974276be9a183ee75d0aca3be3ed80/u);
  for (const artifact of [
    "../bin/linux-x64/aic-notes-sn-bridge",
    "../bin/wasm/aic-notes-sn-bridge.wasm",
    "../bin/wasm/wasm_exec.js",
  ]) {
    const bytes = await readFile(new URL(artifact, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.match(provenance, new RegExp(hash, "u"));
  }
  for (const snapshot of [
    "../vendor/aic-editor-core/draft-session.js",
    "../vendor/aic-editor-core/structured-preview.js",
    "../vendor/aic-editor-core/icons.css",
    "../vendor/aic-editor-core/mermaid-viewport.js",
    "../vendor/aic-editor-core/mermaid-viewport.css",
    "../vendor/aic-editor-core/mermaid-viewport.d.ts",
    "../vendor/aic-editor-core/file-properties.js",
  ]) {
    const bytes = await readFile(new URL(snapshot, import.meta.url));
    const hash = createHash("sha256").update(bytes).digest("hex");
    assert.match(provenance, new RegExp(hash, "u"));
  }
});
