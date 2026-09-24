import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { parse } from "yaml";
import {
  validateReleaseTag,
  validateReleaseMetadata,
  verifyMarketplaceRelease,
} from "../scripts/verify-marketplace-release.mjs";

const tag = "v53.0.1";
const version = "53.0.1";
const fileName = `aic-notes-${version}.vsix`;
const metadata = () => ({
  tagName: tag,
  isDraft: false,
  isPrerelease: false,
  assets: [{ name: fileName }, { name: `${fileName}.sha256` }],
});
const identityXml = (attributes = {}) => {
  const identity = {
    Id: "aic-notes",
    Publisher: "ldzyha",
    Version: version,
    ...attributes,
  };
  return `<PackageManifest><Metadata><Identity ${Object.entries(identity)
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ")} /></Metadata></PackageManifest>`;
};

async function fixture(
  t,
  { manifest = {}, xml = identityXml(), bytes: suppliedBytes } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), "aic-marketplace-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const archive = new AdmZip();
  archive.addFile(
    "extension/package.json",
    Buffer.from(
      JSON.stringify({
        name: "aic-notes",
        publisher: "ldzyha",
        version,
        ...manifest,
      }),
    ),
  );
  archive.addFile("extension.vsixmanifest", Buffer.from(xml));
  const bytes = suppliedBytes ?? archive.toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const vsixPath = path.join(directory, fileName);
  await writeFile(vsixPath, bytes);
  await writeFile(`${vsixPath}.sha256`, `${sha256}  ${fileName}\n`);
  return { directory, vsixPath, bytes, sha256, release: metadata(), tag };
}

test("Marketplace release tag accepts only stable exact versions", () => {
  assert.deepEqual(validateReleaseTag(tag), { version, fileName });
  for (const invalid of [
    "53.0.1",
    "v53.0.1-beta",
    "v01.0.1",
    "v53.0.1/../../bad",
    "v53.0.1\n",
    "$(echo bad)",
    "--help",
    null,
  ])
    assert.throws(() => validateReleaseTag(invalid), /stable vN.N.N/u);
});

test("Marketplace metadata rejects drafts, prereleases, wrong tags and ambiguous assets", () => {
  for (const override of [
    { tagName: "v54.0.1" },
    { isDraft: true },
    { isPrerelease: true },
    { assets: [] },
    { assets: [...metadata().assets, { name: fileName }] },
  ])
    assert.throws(() =>
      validateReleaseMetadata(tag, { ...metadata(), ...override }),
    );
});

test("verifies the existing release bytes independently of the current checkout version", async (t) => {
  const input = await fixture(t);
  assert.deepEqual(await verifyMarketplaceRelease(input), {
    vsixPath: input.vsixPath,
    version,
    sha256: input.sha256,
  });
  assert.deepEqual(await readFile(input.vsixPath), input.bytes);
});

test("rejects changed bytes and a checksum naming a different asset", async (t) => {
  const input = await fixture(t);
  await writeFile(`${input.vsixPath}.sha256`, `${input.sha256}  other.vsix\n`);
  await assert.rejects(verifyMarketplaceRelease(input), /checksum/u);
  await writeFile(`${input.vsixPath}.sha256`, `${input.sha256}  ${fileName}\n`);
  await writeFile(
    input.vsixPath,
    Buffer.concat([input.bytes, Buffer.from("changed")]),
  );
  await assert.rejects(verifyMarketplaceRelease(input), /checksum/u);
});

test("rejects package and XML publisher, name or version mismatches", async (t) => {
  for (const manifest of [
    { publisher: "another-publisher" },
    { name: "another-extension" },
    { version: "54.0.1" },
  ]) {
    const input = await fixture(t, { manifest });
    await assert.rejects(
      verifyMarketplaceRelease(input),
      /Packaged extension/u,
    );
  }
  for (const attributes of [
    { Publisher: "another-publisher" },
    { Id: "another-extension" },
    { Version: "54.0.1" },
    { TargetPlatform: "linux-x64" },
  ]) {
    const input = await fixture(t, { xml: identityXml(attributes) });
    await assert.rejects(verifyMarketplaceRelease(input), /XML identity/u);
  }
});

test("rejects malformed archives and misleading or malformed XML identities", async (t) => {
  await assert.rejects(
    verifyMarketplaceRelease(
      await fixture(t, {
        bytes: Buffer.from("This is not a ZIP archive"),
      }),
    ),
  );
  for (const xml of [
    "<PackageManifest><Metadata>",
    `<PackageManifest><Metadata><!-- <Identity Id="aic-notes" Publisher="ldzyha" Version="${version}" /> --></Metadata></PackageManifest>`,
    identityXml().replace("</Metadata>", `<Identity Id="other" /></Metadata>`),
    `<!DOCTYPE PackageManifest [<!ENTITY name "aic-notes">]>${identityXml()}`,
  ])
    await assert.rejects(verifyMarketplaceRelease(await fixture(t, { xml })));
});

test("Marketplace workflow publishes verified release assets with scoped permissions and explicit credentials", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/publish-marketplace.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(workflow.on.workflow_call.inputs.release_tag.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.release_tag.required, true);
  assert.equal(
    workflow.on.workflow_dispatch.inputs.verification_only.default,
    false,
  );
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  assert.deepEqual(workflow.permissions, {});
  const publish = workflow.jobs.publish;
  assert.deepEqual(publish.permissions, { contents: "read" });
  assert.match(publish.if, /github\.repository == 'ldzyha\/aic-notes'/u);
  assert.match(publish.if, /refs\/heads\/main/u);
  assert.match(publish.if, /refs\/tags\//u);
  const checkout = publish.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout.with.ref, "${{ github.workflow_sha }}");
  assert.equal(checkout.with["persist-credentials"], false);
  const runs = publish.steps.map((step) => step.run ?? "");
  const verification = runs.findIndex((run) =>
    run.includes("node scripts/verify-marketplace-release.mjs"),
  );
  const publication = runs.findIndex((run) => run.includes("vsce publish"));
  assert.ok(verification >= 0 && publication > verification);
  assert.match(runs.join("\n"), /if \[\[ -z "\$VSCE_PAT" \]\]/u);
  const credentialCheck = runs.findIndex((run) =>
    run.includes("vsce verify-pat ldzyha"),
  );
  assert.ok(credentialCheck > verification && credentialCheck < publication);
  assert.equal(
    publish.steps[credentialCheck].if,
    "${{ inputs.verification_only != true }}",
  );
  assert.equal(
    publish.steps[publication].if,
    "${{ inputs.verification_only != true }}",
  );
  assert.match(
    runs[publication],
    /--packagePath "\$VSIX_PATH" --skip-duplicate/u,
  );
  assert.doesNotMatch(
    runs.join("\n"),
    /npm run (?:build|package)|--oidc|vsce login/u,
  );
  const caller = parse(
    await readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(caller.jobs["publish-marketplace"].needs, "verify-universal");
  assert.equal(
    caller.jobs["publish-marketplace"].uses,
    "./.github/workflows/publish-marketplace.yml",
  );
});
