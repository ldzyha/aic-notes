// Explorer file-nesting for notes. The extension ships the patterns as
// configurationDefaults (package.json), but VS Code shadows an object default
// WHOLESALE the moment the user defines their own explorer.fileNesting.patterns.
// This command inspect()s the setting and merges our pairs into the winning
// scope, with a confirmation prompt. Folder notes cannot nest (nesting is
// file-to-file only) — the notes tree covers them.

import * as vscode from "vscode";

// keep in sync with package.json configurationDefaults
export const NOTE_PATTERNS = Object.fromEntries(
  [
    "js", "mjs", "cjs", "ts", "jsx", "tsx", "py", "rs", "go", "java", "rb", "php",
    "css", "scss", "html", "isml", "json", "jsonc", "toml", "yml", "yaml", "md",
    "sh", "sql", "xml", "svg", "txt", "vue", "svelte",
  ]
    .map((ext) => [`*.${ext}`, "${capture}.note.md"])
    .concat([
      [".env", ".env.note.md"],
      [".gitignore", ".gitignore.note.md"],
      ["Makefile", "Makefile.note.md"],
      ["Dockerfile", "Dockerfile.note.md"],
    ]),
);

export async function enableExplorerNesting() {
  const cfg = vscode.workspace.getConfiguration("explorer.fileNesting");
  const info = cfg.inspect("patterns");
  const userValue = info?.workspaceValue ?? info?.globalValue;
  const target = info?.workspaceValue
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  if (!userValue) {
    // no user override — our configurationDefaults already apply; just make
    // sure nesting itself is on
    if (!cfg.get("enabled")) {
      const pick = await vscode.window.showInformationMessage(
        "Explorer file nesting is disabled. Enable it so notes nest under their files?",
        "Enable",
        "Cancel",
      );
      if (pick !== "Enable") return;
      await cfg.update("enabled", true, vscode.ConfigurationTarget.Global);
    } else {
      vscode.window.showInformationMessage(
        "Note nesting patterns are already active (extension defaults).",
      );
    }
    return;
  }

  const missing = Object.entries(NOTE_PATTERNS).filter(([k, v]) => {
    const existing = userValue[k];
    return !existing || !existing.split(",").map((s) => s.trim()).includes(v);
  });
  if (!missing.length) {
    vscode.window.showInformationMessage("Your file-nesting patterns already include notes.");
    return;
  }
  const pick = await vscode.window.showInformationMessage(
    `Your explorer.fileNesting.patterns override hides the extension defaults. Merge ${missing.length} note pattern(s) into your settings?`,
    "Merge",
    "Cancel",
  );
  if (pick !== "Merge") return;

  const merged = { ...userValue };
  for (const [k, v] of missing) {
    merged[k] = merged[k] ? `${merged[k]}, ${v}` : v;
  }
  await cfg.update("patterns", merged, target);
  if (!cfg.get("enabled")) await cfg.update("enabled", true, target);
  vscode.window.showInformationMessage("Note nesting patterns merged.");
}

// one-time activation hint when a user override exists without our pairs
export async function hintIfShadowed(context) {
  if (context.globalState.get("aicNotes.nestingHintShown")) return;
  const info = vscode.workspace.getConfiguration("explorer.fileNesting").inspect("patterns");
  const userValue = info?.workspaceValue ?? info?.globalValue;
  if (!userValue) return;
  const covered = Object.values(userValue).some((v) => String(v).includes(".note.md"));
  if (covered) return;
  await context.globalState.update("aicNotes.nestingHintShown", true);
  const pick = await vscode.window.showInformationMessage(
    "Your explorer.fileNesting.patterns setting overrides AIC Notes' nesting defaults, so notes won't nest under their files.",
    "Merge note patterns",
    "Dismiss",
  );
  if (pick === "Merge note patterns") await enableExplorerNesting();
}
