import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = manifest.version;
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`invalid R.F.B version: ${version}`);
if (version !== "6.6.1") throw new Error(`release gate expects 6.6.1, got ${version}`);

const binary = path.join(root, "bin", "linux-x64", "aic-notes-sn-bridge");
await access(binary);
const binaryStat = await stat(binary);
if ((binaryStat.mode & 0o111) === 0) throw new Error("Standard Notes bridge is not executable");

const vsix = path.join(root, `aic-notes-${version}-linux-x64.vsix`);
const vsixBytes = await readFile(vsix);
const sha256 = createHash("sha256").update(vsixBytes).digest("hex");
const archive = new AdmZip(vsix);
const zipEntries = archive.getEntries();
const entries = zipEntries.map((entry) => entry.entryName);
const required = [
  "extension/package.json",
  "extension/dist/extension.cjs",
  "extension/dist/webview/main.js",
  "extension/bin/linux-x64/aic-notes-sn-bridge",
  "extension/readme.md",
  "extension/changelog.md",
  "extension/LICENSE.txt",
  "extension/PROVENANCE.md",
  "extension/THIRD_PARTY_NOTICES.md",
];
for (const entry of required) {
  if (!entries.includes(entry)) throw new Error(`VSIX is missing ${entry}`);
}
for (const forbidden of ["extension/bridge/", "extension/src/", "extension/test/", ".map"]) {
  if (entries.some((entry) => entry.includes(forbidden))) {
    throw new Error(`VSIX contains forbidden development content matching ${forbidden}`);
  }
}
const packagedManifestEntry = archive.getEntry("extension/package.json");
if (!packagedManifestEntry) throw new Error("packaged manifest is missing");
const packagedManifest = JSON.parse(packagedManifestEntry.getData().toString("utf8"));
if (packagedManifest.version !== version) throw new Error("packaged manifest version mismatch");
if (
  packagedManifest.contributes.configurationDefaults["workbench.editorAssociations"]["*.note.md"] !==
  "aicNotes.noteRedirect"
) {
  throw new Error("packaged note redirect association is missing");
}
const selectionCommand = packagedManifest.contributes.commands.find(
  (value) => value.command === "aicNotes.linkSelectionToNote",
);
if (!selectionCommand) throw new Error("packaged selection-link command is missing");
for (const command of ["aicNotes.enableAgentWorkflow", "aicNotes.syncAgentInstructions"]) {
  if (!packagedManifest.contributes.commands.some((value) => value.command === command)) {
    throw new Error(`packaged agent workflow command is missing: ${command}`);
  }
}
const selectionBinding = packagedManifest.contributes.keybindings.find(
  (value) => value.command === "aicNotes.linkSelectionToNote",
);
if (selectionBinding?.key !== "ctrl+shift+/" || selectionBinding?.mac !== "cmd+shift+/") {
  throw new Error("packaged selection-link keybinding is missing");
}

const secretPattern = /(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|(?:access|refresh)[_-]?token["']?\s*[:=]\s*["'][A-Za-z0-9._-]{24,}|password["']?\s*[:=]\s*["'][^"']{8,}["'])/iu;
for (const entry of zipEntries.filter((value) => /\.(?:js|json|md|cjs)$/u.test(value.entryName))) {
  const content = entry.getData().toString("utf8");
  if (secretPattern.test(content)) throw new Error(`possible secret in ${entry.entryName}`);
}

process.stdout.write(
  `${JSON.stringify({ status: "ok", version, vsix: path.basename(vsix), sha256, entries: entries.length, bridgeBytes: binaryStat.size })}\n`,
);
