import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/u.test(version))
  throw new Error(`invalid R.F.B version: ${version}`);
const changelog = await readFile(path.join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## ${version} —`))
  throw new Error(`CHANGELOG.md has no release entry for ${version}`);

const binary = path.join(root, "bin", "linux-x64", "aic-notes-sn-bridge");
await access(binary);
const binaryStat = await stat(binary);
if (process.platform !== "win32" && (binaryStat.mode & 0o111) === 0)
  throw new Error("Standard Notes bridge is not executable");

const required = [
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/dist/webview/main.js",
  "extension/bin/linux-x64/aic-notes-sn-bridge",
  "extension/bin/wasm/aic-notes-sn-bridge.wasm",
  "extension/bin/wasm/wasm_exec.js",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
  "extension/PROVENANCE.md",
  "extension/THIRD_PARTY_NOTICES.md",
  "extension/FUNCTIONAL_INDEX.md",
];
const forbidden = [
  "extension/bridge/",
  "extension/src/",
  "extension/test/",
  ".map",
  ".vsix.sha256",
];
const secretPattern =
  /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][A-Za-z0-9._-]{24,}|password["']?\s*[:=]\s*["'][^"']{8,}["'])/iu;

async function verifyVsix(target) {
  const vsix = path.join(root, `aic-notes-${version}-${target}.vsix`);
  const bytes = await readFile(vsix);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const checksum = await readFile(`${vsix}.sha256`, "utf8");
  const expectedChecksum = `${sha256}  ${path.basename(vsix)}`;
  if (checksum.trim() !== expectedChecksum)
    throw new Error(`${target} SHA-256 sidecar does not match the VSIX`);
  const archive = new AdmZip(vsix);
  const zipEntries = archive.getEntries();
  const entries = zipEntries.map((entry) => entry.entryName);

  for (const entry of required) {
    if (!entries.includes(entry))
      throw new Error(`${target} VSIX is missing ${entry}`);
  }
  for (const pattern of forbidden) {
    if (entries.some((entry) => entry.includes(pattern)))
      throw new Error(
        `${target} VSIX contains forbidden development content matching ${pattern}`,
      );
  }

  const vsixManifestEntry = archive.getEntry("extension.vsixmanifest");
  if (!vsixManifestEntry) throw new Error(`${target} VSIX manifest is missing`);
  const vsixManifest = vsixManifestEntry.getData().toString("utf8");
  if (!vsixManifest.includes(`TargetPlatform="${target}"`))
    throw new Error(`${target} VSIX has the wrong target platform`);

  const packagedManifestEntry = archive.getEntry("extension/package.json");
  if (!packagedManifestEntry)
    throw new Error(`${target} packaged manifest is missing`);
  const packagedManifest = JSON.parse(
    packagedManifestEntry.getData().toString("utf8"),
  );
  if (packagedManifest.version !== version)
    throw new Error(`${target} packaged manifest version mismatch`);

  const packagedEditorEntry = archive.getEntry(
    "extension/dist/webview/main.js",
  );
  if (!packagedEditorEntry)
    throw new Error(`${target} packaged editor bundle is missing`);
  const packagedEditor = packagedEditorEntry.getData().toString("utf8");
  for (const control of [
    "cm-aic-link-control",
    "Add row",
    "Add column",
    "Add property",
    "cm-aic-property-level",
    "cm-aic-mermaid-viewport",
    "Rotate diagram 90",
    "--aic-mermaid-rotation",
  ]) {
    if (!packagedEditor.includes(control))
      throw new Error(`${target} packaged editor is missing ${control}`);
  }
  if (packagedEditor.includes("cm-md-link-tooltip"))
    throw new Error(
      `${target} packaged editor still contains the retired link tooltip`,
    );

  if (
    packagedManifest.contributes.configurationDefaults[
      "workbench.editorAssociations"
    ]["*.note.md"] !== "aicNotes.noteRedirect"
  )
    throw new Error(`${target} packaged note redirect association is missing`);
  for (const command of [
    "aicNotes.linkSelectionToNote",
    "aicNotes.syncCurrentNote",
    "aicNotes.enableAgentWorkflow",
    "aicNotes.syncAgentInstructions",
  ]) {
    if (
      !packagedManifest.contributes.commands.some(
        (value) => value.command === command,
      )
    )
      throw new Error(`${target} packaged command is missing: ${command}`);
  }
  const selectionBinding = packagedManifest.contributes.keybindings.find(
    (value) =>
      value.command === "aicNotes.linkSelectionToNote" &&
      value.key === "ctrl+alt+l",
  );
  if (selectionBinding?.mac !== "cmd+alt+l")
    throw new Error(`${target} packaged selection-link keybinding is missing`);
  const selectionAlias = packagedManifest.contributes.keybindings.find(
    (value) =>
      value.command === "aicNotes.linkSelectionToNote" &&
      value.key === "ctrl+shift+/",
  );
  if (selectionAlias?.mac !== "cmd+shift+/")
    throw new Error(
      `${target} packaged selection-link compatibility keybinding is missing`,
    );
  const openBinding = packagedManifest.contributes.keybindings.find(
    (value) => value.command === "aicNotes.noteForCurrentFile",
  );
  if (
    openBinding?.key !== "ctrl+alt+n" ||
    openBinding?.mac !== "cmd+alt+n" ||
    openBinding.when
  )
    throw new Error(
      `${target} packaged global open-note keybinding is missing`,
    );

  for (const entry of zipEntries.filter((value) =>
    /\.(?:js|json|md|cjs)$/u.test(value.entryName),
  )) {
    const content = entry.getData().toString("utf8");
    if (secretPattern.test(content))
      throw new Error(`possible secret in ${entry.entryName}`);
  }
  return { vsix: path.basename(vsix), sha256, entries: entries.length };
}

const artifacts = [];
for (const target of ["linux-x64", "win32-x64"])
  artifacts.push(await verifyVsix(target));

process.stdout.write(
  `${JSON.stringify({
    status: "ok",
    version,
    artifacts,
    bridgeBytes: binaryStat.size,
  })}\n`,
);
