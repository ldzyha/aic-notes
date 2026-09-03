import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

const fileName = `aic-notes-${version}.vsix`;
const vsix = path.join(root, fileName);
const bytes = await readFile(vsix);
const sha256 = createHash("sha256").update(bytes).digest("hex");
const checksum = await readFile(`${vsix}.sha256`, "utf8");
if (checksum.trim() !== `${sha256}  ${fileName}`)
  throw new Error("SHA-256 sidecar does not match the universal VSIX");

const archive = new AdmZip(vsix);
const zipEntries = archive.getEntries();
const entries = zipEntries.map((entry) => entry.entryName);
for (const entry of [
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/dist/webview/main.js",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
  "extension/PROVENANCE.md",
  "extension/THIRD_PARTY_NOTICES.md",
  "extension/FUNCTIONAL_INDEX.md",
]) {
  if (!entries.includes(entry)) throw new Error(`VSIX is missing ${entry}`);
}
for (const pattern of [
  "extension/bin/",
  "extension/bridge/",
  "extension/src/",
  "extension/test/",
  ".map",
  ".vsix.sha256",
]) {
  if (entries.some((entry) => entry.includes(pattern)))
    throw new Error(`VSIX contains forbidden content matching ${pattern}`);
}

const vsixManifestEntry = archive.getEntry("extension.vsixmanifest");
if (!vsixManifestEntry) throw new Error("VSIX manifest is missing");
const vsixManifest = vsixManifestEntry.getData().toString("utf8");
if (/TargetPlatform=/u.test(vsixManifest))
  throw new Error("VSIX must be universal, not platform-targeted");

const packagedManifestEntry = archive.getEntry("extension/package.json");
if (!packagedManifestEntry) throw new Error("packaged manifest is missing");
const packagedManifest = JSON.parse(
  packagedManifestEntry.getData().toString("utf8"),
);
if (packagedManifest.version !== version)
  throw new Error("packaged manifest version mismatch");
if (
  packagedManifest.description.includes("Standard Notes") ||
  Object.keys(packagedManifest.contributes.configuration.properties).some(
    (key) => key.startsWith("aicNotes.standardNotes."),
  )
)
  throw new Error("retired Standard Notes integration remains in the manifest");
for (const retired of [
  "aicNotes.syncCurrentNote",
  "aicNotes.pullProjectNotes",
]) {
  if (
    packagedManifest.contributes.commands.some(
      ({ command }) => command === retired,
    )
  )
    throw new Error(`retired command remains: ${retired}`);
}

const packagedEditorEntry = archive.getEntry("extension/dist/webview/main.js");
if (!packagedEditorEntry) throw new Error("packaged editor bundle is missing");
const packagedEditor = packagedEditorEntry.getData().toString("utf8");
for (const control of [
  "cm-aic-link-control",
  "Add row",
  "Add column",
  "Add property",
  "cm-aic-property-level",
  "cm-aic-mermaid-viewport",
  "Copy code",
  "Edit code source",
  "Rotate diagram 90",
  "--aic-mermaid-rotation",
  "Type / for templates",
  "page-architecture",
  "cm-snippetField",
]) {
  if (!packagedEditor.includes(control))
    throw new Error(`packaged editor is missing ${control}`);
}
if (packagedEditor.includes("cm-md-link-tooltip"))
  throw new Error("packaged editor still contains the retired link tooltip");

const packagedHostEntry = archive.getEntry("extension/dist/extension.cjs");
if (!packagedHostEntry) throw new Error("packaged extension host is missing");
const packagedHost = packagedHostEntry.getData().toString("utf8");
for (const retired of [
  "api.standardnotes.com",
  "aic-notes-sn-bridge",
  "sn_remote_ambiguous",
  "syncCurrentNote",
  "pullProjectNotes",
]) {
  if (packagedHost.includes(retired))
    throw new Error(`retired synchronization runtime remains: ${retired}`);
}

for (const command of [
  "aicNotes.linkSelectionToNote",
  "aicNotes.openProjectNote",
  "aicNotes.enableAgentWorkflow",
  "aicNotes.syncAgentInstructions",
]) {
  if (
    !packagedManifest.contributes.commands.some(
      (value) => value.command === command,
    )
  )
    throw new Error(`packaged command is missing: ${command}`);
}
const selectionBinding = packagedManifest.contributes.keybindings.find(
  (value) =>
    value.command === "aicNotes.linkSelectionToNote" &&
    value.key === "ctrl+alt+l",
);
if (selectionBinding?.mac !== "cmd+alt+l")
  throw new Error("packaged selection-link keybinding is missing");
const openBinding = packagedManifest.contributes.keybindings.find(
  (value) => value.command === "aicNotes.noteForCurrentFile",
);
if (
  openBinding?.key !== "ctrl+alt+n" ||
  openBinding?.mac !== "cmd+alt+n" ||
  openBinding.when
)
  throw new Error("packaged global open-note keybinding is missing");

const secretPattern =
  /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][A-Za-z0-9._-]{24,}|password["']?\s*[:=]\s*["'][^"']{8,}["'])/iu;
for (const entry of zipEntries.filter((value) =>
  /\.(?:js|json|md|cjs)$/u.test(value.entryName),
)) {
  const content = entry.getData().toString("utf8");
  if (secretPattern.test(content))
    throw new Error(`possible secret in ${entry.entryName}`);
}

process.stdout.write(
  `${JSON.stringify({
    status: "ok",
    version,
    artifact: fileName,
    sha256,
    entries: entries.length,
  })}\n`,
);
