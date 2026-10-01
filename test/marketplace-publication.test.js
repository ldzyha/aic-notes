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
import {
  marketplacePlan,
  publishVerifiedMarketplaceRelease,
} from "../scripts/publish-marketplace.mjs";

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
  assert.deepEqual(publish.permissions, {
    contents: "read",
    "id-token": "write",
  });
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
  const publication = runs.findIndex((run) =>
    run.includes("node scripts/publish-marketplace.mjs"),
  );
  assert.ok(verification >= 0 && publication > verification);
  const credentialCheck = runs.findIndex((run) =>
    run.includes('case "$VSCE_AUTH_MODE"'),
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
  const login = publish.steps.find((step) =>
    step.uses?.startsWith("Azure/login@"),
  );
  assert.match(login.uses, /^Azure\/login@[a-f0-9]{40}$/u);
  assert.equal(
    login.if,
    "${{ inputs.verification_only != true && vars.VSCE_AUTH_MODE == 'entra' }}",
  );
  assert.equal(login.with["allow-no-subscriptions"], true);
  assert.equal(
    publish.env.VSCE_AUTH_MODE,
    "${{ vars.VSCE_AUTH_MODE || 'pat' }}",
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
  assert.equal(
    caller.jobs["publish-marketplace"].if,
    "startsWith(github.ref, 'refs/tags/') && vars.VSCODE_MARKETPLACE_ENABLED == 'true'",
  );
  assert.equal(caller.jobs["publish-marketplace"].needs, "verify-universal");
  assert.equal(
    caller.jobs["publish-marketplace"].uses,
    "./.github/workflows/publish-marketplace.yml",
  );
  assert.equal(
    caller.jobs["publish-marketplace"].permissions["id-token"],
    "write",
  );
});

test("Marketplace publishing keeps exact VSIX bytes and selects authenticated Entra or PAT explicitly", () => {
  const artifact = {
    vsixPath: "/fixture/aic-notes-53.0.1.vsix",
    version,
    sha256: "1".repeat(64),
  };
  assert.throws(() => marketplacePlan(artifact, {}), /Configure VSCE_PAT/u);
  assert.throws(
    () => marketplacePlan(artifact, { VSCE_AUTH_MODE: "oidc" }),
    /pat or entra/u,
  );
  assert.throws(
    () => marketplacePlan(artifact, { VSCE_AUTH_MODE: "entra" }),
    /federation/u,
  );
  const pat = marketplacePlan(artifact, { VSCE_PAT: "fixture-pat" });
  assert.deepEqual(pat.commands[0], ["verify-pat", "ldzyha"]);
  assert.deepEqual(pat.commands[1], [
    "publish",
    "--packagePath",
    artifact.vsixPath,
    "--skip-duplicate",
  ]);
  const env = {
    VSCE_AUTH_MODE: "entra",
    AZURE_CLIENT_ID: "fixture-client",
    AZURE_TENANT_ID: "fixture-tenant",
    VSCE_PAT: "unrelated-pat",
  };
  const entra = marketplacePlan(artifact, env);
  assert.equal(entra.env.VSCE_PAT, undefined);
  assert.equal(env.VSCE_PAT, "unrelated-pat");
  assert.deepEqual(entra.commands[0], [
    "verify-pat",
    "ldzyha",
    "--azure-credential",
  ]);
  assert.deepEqual(entra.commands[1], [
    "publish",
    "--packagePath",
    artifact.vsixPath,
    "--skip-duplicate",
    "--azure-credential",
  ]);
  const calls = [];
  assert.equal(
    publishVerifiedMarketplaceRelease(artifact, env, (...args) => {
      calls.push(args);
      return { status: 0 };
    }).state,
    "publication-command-completed",
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].shell, false);
  assert.equal(calls[0][2].timeout, 180000);
  assert.equal(calls[0][2].env.VSCE_PAT, undefined);
});

test("Marketplace publisher stops on authentication failure and redacts provider output", () => {
  let calls = 0;
  assert.throws(
    () =>
      publishVerifiedMarketplaceRelease(
        { vsixPath: "/fixture.vsix" },
        { VSCE_PAT: "fixture-pat" },
        () => {
          calls++;
          return {
            status: 1,
            stderr: "fixture-pat and provider token",
            stdout: "fixture-pat",
          };
        },
      ),
    /^Error: Marketplace verify-pat failed; verify publisher authorization and inspect the Marketplace dashboard$/u,
  );
  assert.equal(calls, 1);
});
