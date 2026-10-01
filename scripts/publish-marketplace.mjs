import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMarketplaceRelease } from "./verify-marketplace-release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export function marketplacePlan(artifact, env = process.env) {
  const mode = env.VSCE_AUTH_MODE || "pat";
  if (!["pat", "entra"].includes(mode))
    throw new Error("VSCE_AUTH_MODE must be pat or entra");
  if (mode === "pat" && !env.VSCE_PAT)
    throw new Error(
      "Configure VSCE_PAT publisher access or choose VSCE_AUTH_MODE=entra",
    );
  if (mode === "entra" && (!env.AZURE_CLIENT_ID || !env.AZURE_TENANT_ID))
    throw new Error(
      "Configure the authorized Entra identity and federation before publishing",
    );
  const auth = mode === "entra" ? ["--azure-credential"] : [];
  const childEnv = { ...env };
  if (mode === "entra") delete childEnv.VSCE_PAT;
  return {
    env: childEnv,
    commands: [
      ["verify-pat", "ldzyha", ...auth],
      [
        "publish",
        "--packagePath",
        artifact.vsixPath,
        "--skip-duplicate",
        ...auth,
      ],
    ],
  };
}

export function publishVerifiedMarketplaceRelease(
  artifact,
  env = process.env,
  run = spawnSync,
) {
  const plan = marketplacePlan(artifact, env);
  for (const command of plan.commands) {
    const result = run(
      process.execPath,
      [path.join(root, "node_modules/@vscode/vsce/vsce"), ...command],
      {
        cwd: root,
        env: plan.env,
        encoding: "utf8",
        timeout: 180000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      },
    );
    // Authentication errors can include provider responses. Keep them out of logs.
    if (result.error || result.status !== 0)
      throw new Error(
        `Marketplace ${command[0]} failed; verify publisher authorization and inspect the Marketplace dashboard`,
      );
  }
  return {
    version: artifact.version,
    sha256: artifact.sha256,
    state: "publication-command-completed",
  };
}

async function main() {
  if (process.argv.length !== 5)
    throw new Error(
      "Usage: publish-marketplace.mjs <tag> <release.json> <asset-directory>",
    );
  const [, , tag, metadataPath, directory] = process.argv;
  const release = JSON.parse(await readFile(metadataPath, "utf8"));
  const artifact = await verifyMarketplaceRelease({ tag, release, directory });
  process.stdout.write(
    `${JSON.stringify(publishVerifiedMarketplaceRelease(artifact))}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
