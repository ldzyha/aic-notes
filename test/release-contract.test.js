import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), "utf8");
const packageJson = JSON.parse(await read("package.json"));

test("GitHub releases and the VSIX include the bilingual installation guide", async () => {
  const [guide, workflow, verifier] = await Promise.all([
    read("RELEASE_INSTALL.md"),
    read(".github/workflows/release.yml"),
    read("scripts/verify-release.mjs"),
  ]);
  assert.ok(guide.includes("## English"));
  assert.ok(guide.includes("## Українська"));
  assert.ok(guide.includes(`aic-notes-${packageJson.version}.vsix`));
  assert.ok(workflow.includes("--notes-file RELEASE_INSTALL.md"));
  assert.ok(verifier.includes('"extension/RELEASE_INSTALL.md"'));
});

test("the VS Code editor mounts canonical information, warning and error quotes", async () => {
  const main = await read("src/webview/main.js");
  const callouts = await read("vendor/aic-editor-core/callout-decorations.js");
  assert.match(main, /makeCalloutExtension\(\)/u);
  assert.match(callouts, /!>>\|!>/u);
  assert.match(callouts, /FencedCode/u);
  assert.match(
    await read("vendor/aic-editor-core/preview-layout.css"),
    /cm-md-callout-warning/u,
  );
});

test("retired graph and native note tree have no contribution or runtime", async () => {
  const manifest = JSON.stringify(packageJson.contributes);
  assert.doesNotMatch(manifest, /contextSphere|File Context/u);
  assert.ok(
    packageJson.contributes.views.aicNotesSecondary.some(
      (view) => view.id === "aicNotes.secondary",
    ),
  );
  assert.equal(packageJson.contributes.views.aicNotes, undefined);
  assert.equal(packageJson.contributes.viewsContainers.activitybar, undefined);
  assert.doesNotMatch(manifest, /aicNotes\.tree|Notes & Documents/u);
  const extension = await read("src/extension.js");
  assert.doesNotMatch(
    extension,
    /ContextSphere|sphere-provider|NotesTree|registerTreeDataProvider/u,
  );
  assert.doesNotMatch(await read("esbuild.mjs"), /sphere\.js/u);
  for (const file of [
    "src/context/sphere-provider.js",
    "src/context/sphere-graph.js",
    "src/webview/sphere.js",
    "src/notes/tree.js",
  ])
    await assert.rejects(access(new URL(file, root)));
});

test("legacy YAML Properties stay raw while aic blocks use the shared widget", async () => {
  const main = await read("src/webview/main.js");
  const shared = await read("vendor/aic-editor-core/security-block.js");
  assert.match(main, /makePropertiesBlockExtension/u);
  assert.match(main, /setPropertyRelationships/u);
  assert.doesNotMatch(main, /makeFrontmatterExtension|handlers\/frontmatter/u);
  assert.match(shared, /class SecurityBlockWidget extends WidgetType/u);
  assert.match(shared, /YAML Properties are no longer supported/u);
  assert.match(shared, /use an aic block/u);
  await assert.rejects(access(new URL("src/notes/header-label.js", root)));
  await assert.rejects(
    access(new URL("vendor/markdown/handlers/frontmatter.js", root)),
  );
});

test("both VS Code editor surfaces mount the shared local guide", async () => {
  const main = await read("src/webview/main.js");
  assert.match(
    main,
    /import \{ createEditorHelp \} from "\.\.\/\.\.\/vendor\/aic-editor-core\/editor-help\.js"/u,
  );
  assert.match(main, /createEditorHelp\(document, \{ host: "vscode" \}\)/u);
  assert.match(main, /setAttribute\("popover", "auto"\)/u);
  assert.match(main, /aria-label", "Open editor guide"/u);
  assert.doesNotMatch(main, /innerHTML.*editor guide/iu);
});

test("VS Code surfaces show no date label and own one in-place source toggle", async () => {
  const [secondary, editor, webview] = await Promise.all([
    read("src/secondary/provider.js"),
    read("src/editor/provider.js"),
    read("src/webview/main.js"),
  ]);
  assert.doesNotMatch(
    secondary,
    /createNoteHeaderLabel|Intl\.DateTimeFormat|\.mtime/u,
  );
  assert.match(secondary, /view\.description = undefined/u);
  assert.match(
    secondary,
    /id="pane-target"[^>]*data-aic-icon="open"[^>]*aria-label="Open linked source file"/u,
  );
  assert.doesNotMatch(
    secondary,
    /id="pane-target"[^>]*data-aic-icon="source"/u,
  );
  assert.doesNotMatch(editor, /document-source|source\.open/u);
  assert.doesNotMatch(webview, /document-source|Open original file/u);
  assert.equal(webview.match(/sourceMode\.createButton\(/gu)?.length, 1);
});

test("the current release is a universal local editor without account connectivity", () => {
  assert.equal(packageJson.version, "53.0.1");
  assert.equal(packageJson.aicEditorCore, "7.3.1");
  assert.equal(packageJson.engines.vscode, "^1.106.0");
  assert.match(packageJson.description, /Local AIC Markdown/u);
  assert.match(
    packageJson.description,
    /no account connection or note synchronization/u,
  );
  assert.doesNotMatch(packageJson.scripts.package, /--target|linux|win32/iu);
  assert.equal(packageJson.scripts["package:windows"], undefined);
  assert.match(packageJson.scripts["release:gate"], /release:checksum/u);

  const commands = packageJson.contributes.commands.map(
    ({ command }) => command,
  );
  assert.ok(commands.includes("aicNotes.openProjectNote"));
  assert.ok(commands.includes("aicNotes.linkSelectionToNote"));
  for (const command of [
    "aicNotes.refreshTree",
    "aicNotes.copyWikiLink",
    "aicNotes.deleteNote",
    "aicNotes.deleteFolderNotes",
  ])
    assert.ok(!commands.includes(command));
  assert.ok(!commands.includes("aicNotes.syncCurrentNote"));
  assert.ok(!commands.includes("aicNotes.pullProjectNotes"));
  for (const command of [
    "aicNotes.standardNotesAccount",
    "aicNotes.signInStandardNotes",
    "aicNotes.signOutStandardNotes",
    "aicNotes.checkStandardNotesConnection",
  ])
    assert.ok(!commands.includes(command));
  assert.ok(
    !JSON.stringify(packageJson.contributes.menus).includes(
      "standardNotesAccount",
    ),
  );
  assert.ok(!Object.hasOwn(packageJson.devDependencies, "@noble/hashes"));
  assert.ok(!Object.hasOwn(packageJson.devDependencies, "proper-lockfile"));
  assert.ok(
    !Object.keys(packageJson.contributes.configuration.properties).some((key) =>
      key.startsWith("aicNotes.standardNotes."),
    ),
  );
});

test("note association, project fallback, and local footer actions are explicit", async () => {
  assert.equal(
    packageJson.contributes.configurationDefaults[
      "workbench.editorAssociations"
    ]["*.note.md"],
    "aicNotes.markdown",
  );
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac, when: binding.when },
    { key: "ctrl+alt+n", mac: "cmd+alt+n", when: undefined },
  );

  const [provider, create, target] = await Promise.all([
    read("src/secondary/provider.js"),
    read("src/notes/create.js"),
    read("src/notes/target.js"),
  ]);
  assert.match(provider, /id="secondary-footer"/u);
  assert.match(provider, /id="pane-target"/u);
  assert.match(provider, /id="pane-clear"/u);
  assert.match(provider, /id="pane-pin"/u);
  assert.doesNotMatch(provider, /pane-auth|pane-sync|pane-delete/u);
  assert.match(provider, /new NavigationQueue\(\)/u);
  assert.match(provider, /activeWindowResource\(vscode\.window\)/u);
  assert.match(provider, /preferredWorkspaceFolder/u);
  assert.match(
    provider,
    /this\.followTargetNow\(folder\.uri, \{ preserveFocus: true, isCurrent \}\)/u,
  );
  assert.match(
    create,
    /secondary\.followSource\(uri, \{ force: true, preserveFocus: false \}\)/u,
  );
  assert.match(
    create,
    /secondary\.followTarget\(uri, \{ force: true, preserveFocus: false \}\)/u,
  );
  assert.doesNotMatch(create, /openGlobalNote|GLOBAL_NOTE_PATH/u);
  assert.match(target, /relNotePath === `\$\{folder\.name\}\.note\.md`/u);
  assert.doesNotMatch(provider, /aicNotes\.refreshTree/u);
});

test("Secondary save and Trash paths are deterministic and local", async () => {
  const [provider, webview, extension, secondaryDraft, theme] =
    await Promise.all([
      read("src/secondary/provider.js"),
      read("src/webview/main.js"),
      read("src/extension.js"),
      read("src/webview/secondary-draft.js"),
      read("src/webview/theme.css"),
    ]);
  assert.match(provider, /case "commit"[\s\S]*commitDraft/u);
  assert.match(provider, /createNoteDocument/u);
  assert.doesNotMatch(provider, /workspace\.fs\.writeFile/u);
  assert.match(provider, /saved = await document\.save\(\)/u);
  assert.doesNotMatch(
    provider,
    /Saved locally|pane-filename|pane-breadcrumb|secondary-controls/u,
  );
  assert.match(provider, /id="pane-save-indicator"[^>]*role="img"/u);
  assert.match(provider, /id="pane-status"[^>]*aria-live="polite"/u);
  assert.match(theme, /data-save-state="dirty"[\s\S]*var\(--warn\) 4%/u);
  assert.doesNotMatch(theme, /data-save-state="saved"|#5aa66a/u);
  assert.match(
    provider,
    /trashNotesLocally\(\[uri\], \{ beforeDelete: current \}\)/u,
  );
  assert.match(
    provider,
    /Only the local sidecar moves to the operating-system Trash/u,
  );
  assert.doesNotMatch(
    provider,
    /Standard Notes|syncService|queueSync|performSync|authenticate|authConnected|remoteUuid|bindingState/iu,
  );
  assert.doesNotMatch(
    extension,
    /StandardNotesSync|src\/sync|initializeWorkspaceSync|remoteFirstTrash/u,
  );
  assert.doesNotMatch(webview, /commitDraft\("blur"\)|onfocusout/u);
  assert.match(webview, /commitDraft\("explicit"\)/u);
  assert.match(webview, /dataset\.saveState/u);
  assert.match(secondaryDraft, /DraftSession/u);
  assert.match(webview, /SecondaryDraft/u);
  assert.match(webview, /type: "draft\.state"/u);
  assert.doesNotMatch(webview, /pane\.auth/u);
});

test("upgrade removes only retired local integration metadata", async () => {
  const extension = await read("src/extension.js");
  assert.match(extension, /async function removeRetiredSyncData\(context\)/u);
  assert.match(extension, /aicNotes\.migrations\.standardNotesRemoved\.v22/u);
  assert.match(
    extension,
    /context\.globalState\.get\(RETIRED_SYNC_CLEANUP_KEY, false\)/u,
  );
  assert.match(extension, /aicNotes\.standardNotes\.vaultKey\.v1/u);
  assert.match(extension, /context\.workspaceState[\s\S]*\.keys\(\)/u);
  assert.match(extension, /key\.startsWith\(RETIRED_SYNC_STATE_PREFIX\)/u);
  assert.match(
    extension,
    /Uri\.joinPath\(context\.globalStorageUri, "standard-notes"\)/u,
  );
  assert.match(extension, /Promise\.allSettled\(removals\)/u);
  assert.match(
    extension,
    /context\.globalState\.update\(RETIRED_SYNC_CLEANUP_KEY, true\)/u,
  );
  assert.doesNotMatch(extension, /fetch\(|https?:\/\/|openExternal/u);
  assert.match(extension, /await removeRetiredAuthData\(context\)/u);
  assert.doesNotMatch(
    extension,
    /registerStandardNotesAuth|StandardNotesAuthTransport/u,
  );
});

test("active account runtime and its host-only smoke script are absent", async () => {
  for (const relativePath of ["src/auth", "scripts/host-auth-smoke.cjs"])
    await assert.rejects(access(new URL(relativePath, root)));
});

test("retired synchronization source, bridge, and binaries are absent", async () => {
  for (const relativePath of ["src/sync", "bridge", "bin"]) {
    await assert.rejects(
      access(new URL(relativePath, root)),
      (error) => error?.code === "ENOENT",
      relativePath,
    );
  }
});

test("source selections cross both VS Code and custom-editor boundaries", async () => {
  const [provider, webview, selection, extension] = await Promise.all([
    read("src/editor/provider.js"),
    read("src/webview/main.js"),
    read("src/notes/selection.js"),
    read("src/extension.js"),
  ]);
  const bindings = packageJson.contributes.keybindings.filter(
    ({ command }) => command === "aicNotes.linkSelectionToNote",
  );
  assert.ok(
    bindings.some(
      ({ key, mac }) => key === "ctrl+alt+l" && mac === "cmd+alt+l",
    ),
  );
  assert.ok(
    bindings.some(
      ({ key, mac }) => key === "ctrl+shift+/" && mac === "cmd+shift+/",
    ),
  );
  assert.match(provider, /async activeSourceSelection\(\)/u);
  assert.match(provider, /type: "selection\.request"/u);
  assert.match(provider, /case "selection\.snapshot"/u);
  assert.match(webview, /type: "selection\.snapshot"/u);
  assert.match(webview, /type: "selection\.link", anchor, head/u);
  assert.match(selection, /document\.isDirty/u);
  assert.doesNotMatch(
    selection,
    /await document\.save\(\)|workspace\.applyEdit|ensureNoteFile/u,
  );
  assert.match(selection, /selection_source_unsaved/u);
  assert.match(selection, /document\.getText\(editor\.selection\)/u);
  assert.match(selection, /secondary\.insertLinkedCode/u);
  assert.match(webview, /case "linkedCode\.insert"/u);
  assert.match(extension, /linkSelectionToNote\(secondary, markdownEditor\)/u);
});

test("preview selection stays native while Ctrl+A reveals source", async () => {
  const [webview, details, structured] = await Promise.all([
    read("src/webview/main.js"),
    read("src/webview/details.js"),
    read("vendor/aic-editor-core/structured-preview.js"),
  ]);
  assert.match(webview, /wirePreviewSelection\(editor, document\)/u);
  assert.match(structured, /event\.key\.toLowerCase\(\) !== "a"/u);
  assert.match(
    structured,
    /selection: \{ anchor: 0, head: editor\.state\.doc\.length \}/u,
  );
  assert.doesNotMatch(
    structured,
    /addEventListener\("pointerup"|userEvent: "select\.pointer"/u,
  );
  assert.match(details, /selectionRevealsPreview/u);
  assert.doesNotMatch(webview, /paneMode|setPaneMode|@codemirror\/search/u);
  assert.match(details, /EditorView\.decorations\.from\(field\)/u);
  assert.match(details, /dataset\.aicIcon = "chevron"/u);
  assert.match(details, /data\.taskOffset/u);
});

test("structured previews keep explicit icon actions and transient editors", async () => {
  const [
    structured,
    previewRanges,
    codeCore,
    codeExtension,
    table,
    frontmatter,
    codeFence,
    mermaid,
    styles,
    icons,
  ] = await Promise.all([
    read("vendor/aic-editor-core/structured-preview.js"),
    read("vendor/aic-editor-core/preview-ranges.js"),
    read("vendor/aic-editor-core/code-fence-preview.js"),
    read("vendor/aic-editor-core/code-fence-extension.js"),
    read("vendor/markdown/handlers/table.js"),
    read("vendor/aic-editor-core/security-block.js"),
    read("vendor/markdown/handlers/code-fence.js"),
    read("vendor/markdown/mermaid.js"),
    read("vendor/markdown/styles.js"),
    read("vendor/aic-editor-core/icons.css"),
  ]);
  assert.match(structured, /cm-aic-cell-popover/u);
  assert.match(structured, /document\.createElement\("textarea"\)/u);
  assert.match(structured, /cm-aic-link-control/u);
  assert.match(structured, /icon: "copy"/u);
  assert.match(previewRanges, /PREVIEW_RANGES_CORE_VERSION = "1\.0\.0"/u);
  assert.match(previewRanges, /EditorView\.atomicRanges\.of/u);
  assert.match(codeCore, /CODE_FENCE_PREVIEW_CORE_VERSION = "1\.1\.0"/u);
  assert.match(codeCore, /Copy code/u);
  assert.match(codeCore, /Edit code source/u);
  assert.match(codeCore, /Cut .* block/u);
  assert.match(codeExtension, /CODE_FENCE_EXTENSION_CORE_VERSION = "1\.2\.0"/u);
  assert.match(codeExtension, /class CodeFenceWidget extends WidgetType/u);
  assert.match(codeExtension, /selectionRevealsPreview/u);
  assert.match(codeExtension, /effects: editCodeFenceSource\.of/u);
  for (const adapter of [table, frontmatter, mermaid]) {
    assert.match(adapter, /providePreviewRanges/u);
  }
  assert.match(table, /Copy table/u);
  assert.match(table, /Cut table/u);
  assert.match(table, /Add row/u);
  assert.match(table, /Add column/u);
  assert.match(frontmatter, /makePropertiesBlockExtension/u);
  assert.match(frontmatter, /Copy properties/u);
  assert.match(frontmatter, /Cut properties/u);
  assert.match(codeFence, /aic-editor-core\/code-fence-extension\.js/u);
  assert.doesNotMatch(codeFence, /class CodeFenceWidget/u);
  assert.match(mermaid, /icon: "copy"/u);
  assert.match(mermaid, /Cut Mermaid block/u);
  assert.match(styles, /overflow-x: auto/u);
  assert.match(styles, /word-break: normal/u);
  assert.match(styles, /overflow-wrap: normal/u);
  assert.match(styles, /cm-aic-cell-popover/u);
  assert.match(icons, /mask: var\(--aic-icon\)/u);
  assert.match(icons, /data-aic-icon="copy"/u);
  assert.match(icons, /data-aic-icon="cut"/u);
  assert.doesNotMatch(
    table + frontmatter + codeFence + mermaid,
    /createElementNS\(/u,
  );
});

test("pin uses a recognizable shared thumbtack with outlined and filled states", async () => {
  const [icons, provider, webview] = await Promise.all([
    read("vendor/aic-editor-core/icons.css"),
    read("src/secondary/provider.js"),
    read("src/webview/main.js"),
  ]);
  assert.match(icons, /data-aic-icon="pin"\]\[aria-pressed="true"/u);
  assert.match(icons, /M5 2h6v2l-1 1v4l2 2H4l2-2V5L5 4Z/u);
  assert.match(
    provider,
    /data-aic-icon="pin" aria-label="Pin note" aria-pressed="false"/u,
  );
  assert.match(webview, /msg.pinned \? "Unpin note" : "Pin note"/u);
});

test("shared slash templates are mounted with the common placeholder and styling", async () => {
  const [webview, snippets, snippetCss] = await Promise.all([
    read("src/webview/main.js"),
    read("vendor/aic-editor-core/slash-snippets.js"),
    read("vendor/aic-editor-core/slash-snippets.css"),
  ]);
  assert.match(snippets, /SLASH_SNIPPETS_CORE_VERSION = "1\.2\.0"/u);
  assert.match(snippets, /"page-architecture"/u);
  assert.match(snippets, /"section"/u);
  assert.match(snippets, /"noise"/u);
  assert.match(snippets, /"wave"/u);
  assert.match(snippets, /"flowchart"/u);
  assert.match(snippets, /snippetCompletion/u);
  assert.match(snippets, /EditorState\.readOnly|state\.readOnly/u);
  assert.match(webview, /slashSnippetExtension\(\)/u);
  assert.match(webview, /SLASH_SNIPPET_PLACEHOLDER/u);
  assert.match(webview, /slash-snippets\.css/u);
  assert.match(
    snippetCss,
    /\.cm-editor \.cm-tooltip\.cm-tooltip-autocomplete/u,
  );
  assert.match(snippetCss, /background-color: var\(--aic-bg\)/u);
  assert.match(snippetCss, /completion-section/u);
  assert.match(snippetCss, /position: static/u);
  assert.doesNotMatch(snippetCss, /position: sticky/u);
  assert.match(snippetCss, /cm-snippetField/u);
});

test("plain Markdown and contextual notes load the same slash-enabled editor", async () => {
  const [markdownProvider, noteProvider, nativeProvider, extension, webview] =
    await Promise.all([
      read("src/editor/provider.js"),
      read("src/secondary/provider.js"),
      read("src/editor/slash-provider.js"),
      read("src/extension.js"),
      read("src/webview/main.js"),
    ]);
  assert.match(
    markdownProvider,
    /webviewHtml\(\s*webview,\s*distRoot,\s*"main\.js"/u,
  );
  assert.match(noteProvider, /distRoot,[\s\S]*"main\.js"/u);
  assert.match(
    webview,
    /function makeEditor\(text\)[\s\S]*placeholder\(SLASH_SNIPPET_PLACEHOLDER\),[\s\S]*slashSnippetExtension\(\)/u,
  );
  assert.match(nativeProvider, /DOCUMENTATION_SNIPPETS/u);
  assert.match(nativeProvider, /registerCompletionItemProvider/u);
  assert.match(nativeProvider, /language: "markdown"/u);
  assert.match(extension, /registerMarkdownSlashCompletionProvider\(vscode\)/u);
  assert.ok(packageJson.activationEvents.includes("onLanguage:markdown"));
});

test("Mermaid owns preview zoom and two-dimensional scroll", async () => {
  const [viewport, viewportCss, mermaid] = await Promise.all([
    read("vendor/aic-editor-core/mermaid-viewport.js"),
    read("vendor/aic-editor-core/mermaid-viewport.css"),
    read("vendor/markdown/mermaid.js"),
  ]);
  assert.match(viewport, /Zoom in/u);
  assert.doesNotMatch(viewport, /Rotate diagram|rotation/u);
  assert.match(viewport, /stage\.style\.width = pixels\(fitted\)/u);
  assert.match(viewport, /stage\.style\.height = pixels\(fitted \/ ratio\)/u);
  assert.match(viewportCss, /overflow: auto/u);
  assert.doesNotMatch(viewportCss, /--aic-mermaid-rotation/u);
  assert.match(mermaid, /createMermaidViewport/u);
});

test("saves do not synthesize or rewrite legacy YAML Properties", async () => {
  const [extension, secondary, editor, create] = await Promise.all([
    read("src/extension.js"),
    read("src/secondary/provider.js"),
    read("src/editor/provider.js"),
    read("src/notes/create.js"),
  ]);
  assert.doesNotMatch(extension, /legacyPropertyCleanupEdits/u);
  assert.doesNotMatch(secondary, /stampNoteProperties|stampFileProperties/u);
  assert.doesNotMatch(editor, /stampNoteProperties|stampFileProperties/u);
  assert.doesNotMatch(create, /stampNoteProperties|stampFileProperties/u);
  assert.match(create, /AIC_EMPTY_DOCUMENT/u);
  for (const file of [
    "src/notes/properties.js",
    "vendor/aic-editor-core/file-properties.js",
  ])
    await assert.rejects(access(new URL(file, root)));
});

test("universal release gate rejects platform and retired integration content", async () => {
  const [workflow, verifier, checksum, ignore] = await Promise.all([
    read(".github/workflows/release.yml"),
    read("scripts/verify-release.mjs"),
    read("scripts/checksum.mjs"),
    read(".vscodeignore"),
  ]);
  assert.match(workflow, /verify-universal/u);
  assert.doesNotMatch(
    workflow,
    /setup-go|package:windows|linux-x64|win32-x64/u,
  );
  assert.match(workflow, /npm run release:checksum/u);
  assert.match(workflow, /aic-notes-\$VERSION\.vsix/u);
  assert.match(verifier, /TargetPlatform=/u);
  assert.match(verifier, /extension\/bin\//u);
  assert.match(verifier, /extension\/bridge\//u);
  assert.match(verifier, /retired account runtime remains/u);
  assert.match(checksum, /createHash\("sha256"\)/u);
  assert.doesNotMatch(ignore, /!bin\/|bridge\/\*\*/u);
});

test("portable agent workflow remains independent from note persistence", async () => {
  const [bootstrap, contract] = await Promise.all([
    read("src/agents/bootstrap.js"),
    read("src/agents/contract.js"),
  ]);
  assert.match(bootstrap, /aicNotes\.enableAgentWorkflow/u);
  assert.match(bootstrap, /aicNotes\.syncAgentInstructions/u);
  assert.match(bootstrap, /aic-agent\.json/u);
  assert.match(bootstrap, /runAic\(\["rules", "status", "--json"\]\)/u);
  assert.match(bootstrap, /runAic\(\["rules", "sync", "--json"\]\)/u);
  assert.doesNotMatch(bootstrap + contract, /standardNotes|Standard Notes/iu);
});
