import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFile(new URL(relativePath, root), "utf8");
const packageJson = JSON.parse(await read("package.json"));

test("25.0.3 is a local-only universal extension", () => {
  assert.equal(packageJson.version, "25.0.3");
  assert.equal(packageJson.aicEditorCore, "3.1.0");
  assert.equal(packageJson.engines.vscode, "^1.106.0");
  assert.match(packageJson.description, /Local AIC Markdown/u);
  assert.doesNotMatch(packageJson.description, /Standard Notes|sync/iu);
  assert.doesNotMatch(packageJson.scripts.package, /--target|linux|win32/iu);
  assert.equal(packageJson.scripts["package:windows"], undefined);
  assert.match(packageJson.scripts["release:gate"], /release:checksum/u);

  const commands = packageJson.contributes.commands.map(
    ({ command }) => command,
  );
  assert.ok(commands.includes("aicNotes.openProjectNote"));
  assert.ok(commands.includes("aicNotes.linkSelectionToNote"));
  assert.ok(!commands.includes("aicNotes.syncCurrentNote"));
  assert.ok(!commands.includes("aicNotes.pullProjectNotes"));
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
    "aicNotes.noteRedirect",
  );
  const binding = packageJson.contributes.keybindings.find(
    ({ command }) => command === "aicNotes.noteForCurrentFile",
  );
  assert.deepEqual(
    { key: binding.key, mac: binding.mac, when: binding.when },
    { key: "ctrl+alt+n", mac: "cmd+alt+n", when: undefined },
  );

  const [provider, create, target, tree] = await Promise.all([
    read("src/secondary/provider.js"),
    read("src/notes/create.js"),
    read("src/notes/target.js"),
    read("src/notes/tree.js"),
  ]);
  assert.match(provider, /id="secondary-footer"/u);
  assert.match(provider, /id="pane-target"/u);
  assert.match(provider, /id="pane-clear"/u);
  assert.match(provider, /id="pane-pin"/u);
  assert.doesNotMatch(provider, /pane-auth|pane-sync|pane-delete/u);
  assert.match(provider, /new NavigationQueue\(\)/u);
  assert.match(
    provider,
    /activeResource\(\s*activeTabUri,\s*activeEditorUri,\s*Boolean\(activeTab\),\s*\)/u,
  );
  assert.match(provider, /preferredWorkspaceFolder/u);
  assert.match(
    provider,
    /this\.followTarget\(folder\.uri, \{ preserveFocus: true \}\)/u,
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
  assert.match(tree, /projectPlaceholder/u);
  assert.match(tree, /Project note/u);
});

test("Secondary save and Trash paths are deterministic and local", async () => {
  const [provider, webview, extension] = await Promise.all([
    read("src/secondary/provider.js"),
    read("src/webview/main.js"),
    read("src/extension.js"),
  ]);
  assert.match(provider, /case "commit"[\s\S]*commitDraft/u);
  assert.match(provider, /workspace\.fs\.writeFile/u);
  assert.match(provider, /saved = await document\.save\(\)/u);
  assert.match(provider, /Saved locally/u);
  assert.match(provider, /trashNotesLocally\(\[uri\]\)/u);
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
  assert.match(webview, /DraftSession/u);
  assert.match(webview, /type: "draft\.state"/u);
  assert.doesNotMatch(
    webview,
    /readOnlyCompartment|docState\.readOnly|pane\.auth/u,
  );
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
  assert.match(selection, /await document\.save\(\)/u);
  assert.match(selection, /document\.getText\(editor\.selection\)/u);
  assert.match(selection, /secondary\.open[\s\S]*selection:/u);
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
    read("vendor/markdown/handlers/frontmatter.js"),
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
  assert.match(codeCore, /CODE_FENCE_PREVIEW_CORE_VERSION = "1\.0\.0"/u);
  assert.match(codeCore, /Copy code/u);
  assert.match(codeCore, /Edit code source/u);
  assert.match(codeExtension, /CODE_FENCE_EXTENSION_CORE_VERSION = "1\.1\.0"/u);
  assert.match(codeExtension, /class CodeFenceWidget extends WidgetType/u);
  assert.match(codeExtension, /selectionRevealsPreview/u);
  assert.match(codeExtension, /effects: editCodeFenceSource\.of/u);
  for (const adapter of [table, frontmatter, mermaid]) {
    assert.match(adapter, /providePreviewRanges/u);
  }
  assert.match(table, /Copy table/u);
  assert.match(table, /Add row/u);
  assert.match(table, /Add column/u);
  assert.match(frontmatter, /Add property/u);
  assert.match(codeFence, /aic-editor-core\/code-fence-extension\.js/u);
  assert.doesNotMatch(codeFence, /class CodeFenceWidget/u);
  assert.match(mermaid, /icon: "copy"/u);
  assert.match(styles, /overflow-x: auto/u);
  assert.match(styles, /word-break: normal/u);
  assert.match(styles, /overflow-wrap: normal/u);
  assert.match(styles, /cm-aic-cell-popover/u);
  assert.match(icons, /mask: var\(--aic-icon\)/u);
  assert.match(icons, /data-aic-icon="copy"/u);
  assert.doesNotMatch(
    table + frontmatter + codeFence + mermaid,
    /createElementNS\(/u,
  );
});

test("Mermaid owns zoom, two-dimensional scroll, and quarter-turn rotation", async () => {
  const [viewport, viewportCss, mermaid] = await Promise.all([
    read("vendor/aic-editor-core/mermaid-viewport.js"),
    read("vendor/aic-editor-core/mermaid-viewport.css"),
    read("vendor/markdown/mermaid.js"),
  ]);
  assert.match(viewport, /Rotate diagram 90° clockwise/u);
  assert.match(viewport, /rotation = \(\(nextRotation % 360\) \+ 360\) % 360/u);
  assert.match(viewport, /stage\.style\.width = pixels\(boundsWidth\)/u);
  assert.match(viewport, /stage\.style\.height = pixels\(boundsHeight\)/u);
  assert.match(viewportCss, /overflow: auto/u);
  assert.match(viewportCss, /--aic-mermaid-rotation/u);
  assert.match(mermaid, /createMermaidViewport/u);
});

test("properties are note-only and update on explicit save", async () => {
  const [extension, secondary, properties] = await Promise.all([
    read("src/extension.js"),
    read("src/secondary/provider.js"),
    read("vendor/aic-editor-core/file-properties.js"),
  ]);
  assert.match(extension, /onWillSaveTextDocument/u);
  assert.match(extension, /lowerPath\.endsWith\("\.note\.md"\)/u);
  assert.match(extension, /legacyPropertyCleanupEdits/u);
  assert.match(secondary, /stampNoteProperties/u);
  assert.match(secondary, /createdAt/u);
  assert.match(secondary, /updatedAt/u);
  assert.match(properties, /name\.endsWith\("\.note\.md"\)/u);
  assert.match(properties, /fileName/u);
  assert.match(properties, /created/u);
  assert.match(properties, /updated/u);
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
  assert.match(verifier, /retired synchronization runtime remains/u);
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
