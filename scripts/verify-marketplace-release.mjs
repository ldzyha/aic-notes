import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";

export function validateReleaseTag(tag) {
  if (
    typeof tag !== "string" ||
    !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u.test(tag)
  )
    throw new Error("Release tag must be a stable vN.N.N version");
  const version = tag.slice(1);
  return { version, fileName: `aic-notes-${version}.vsix` };
}

export function validateReleaseMetadata(tag, release) {
  const identity = validateReleaseTag(tag);
  if (
    release?.tagName !== tag ||
    release.isDraft !== false ||
    release.isPrerelease !== false
  )
    throw new Error(
      "Use the exact published stable GitHub release, not a draft or prerelease",
    );
  for (const name of [identity.fileName, `${identity.fileName}.sha256`]) {
    const assets = release.assets?.filter((asset) => asset.name === name);
    if (!assets || assets.length !== 1)
      throw new Error(`Release must contain exactly one ${name} asset`);
  }
  return identity;
}

export async function verifyMarketplaceRelease({ tag, release, directory }) {
  const { version, fileName } = validateReleaseMetadata(tag, release);
  const vsixPath = path.resolve(directory, fileName);
  for (const file of [vsixPath, `${vsixPath}.sha256`]) {
    if (!(await lstat(file)).isFile())
      throw new Error("Release assets must be regular files");
  }
  const bytes = await readFile(vsixPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const checksum = await readFile(`${vsixPath}.sha256`, "utf8");
  if (checksum.trim() !== `${sha256}  ${fileName}`)
    throw new Error("GitHub release VSIX checksum does not match");

  const archive = new AdmZip(bytes);
  const entries = archive.getEntries();
  const names = entries.map((entry) => entry.entryName);
  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        name.startsWith("/") ||
        name.includes("\\") ||
        name.split("/").includes(".."),
    )
  )
    throw new Error("VSIX contains duplicate or unsafe archive paths");
  const manifestText = (name) => {
    const entry = entries.find((item) => item.entryName === name);
    if (!entry || entry.isDirectory || entry.header.size > 1_048_576)
      throw new Error(`VSIX must contain one bounded ${name}`);
    return entry.getData().toString("utf8");
  };
  const manifest = JSON.parse(manifestText("extension/package.json"));
  if (
    manifest.publisher !== "ldzyha" ||
    manifest.name !== "aic-notes" ||
    manifest.version !== version
  )
    throw new Error(
      "Packaged extension publisher, name or version does not match the release",
    );

  const xml = manifestText("extension.vsixmanifest");
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml))
    throw new Error(
      "VSIX manifest must not declare document types or entities",
    );
  const parsed = await parseStringPromise(xml, {
    strict: true,
    explicitArray: true,
  });
  const metadata = parsed?.PackageManifest?.Metadata;
  const identities = metadata?.length === 1 ? metadata[0].Identity : null;
  const identity = identities?.length === 1 ? identities[0].$ : null;
  if (
    identity?.Publisher !== "ldzyha" ||
    identity.Id !== "aic-notes" ||
    identity.Version !== version ||
    Object.hasOwn(identity, "TargetPlatform")
  )
    throw new Error(
      "VSIX XML identity must match the universal ldzyha.aic-notes release",
    );
  return { vsixPath, version, sha256 };
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  try {
    if (process.argv.length !== 5)
      throw new Error(
        "Usage: verify-marketplace-release.mjs <tag> <release.json> <asset-directory>",
      );
    const [, , tag, metadataPath, directory] = process.argv;
    const release = JSON.parse(await readFile(metadataPath, "utf8"));
    const result = await verifyMarketplaceRelease({ tag, release, directory });
    process.stdout.write(
      `Verified ldzyha.aic-notes ${result.version}: ${result.sha256}\n`,
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
