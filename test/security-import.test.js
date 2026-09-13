import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { convertAuthenticatorJson } from "../vendor/aic-editor-core/security-import.js";
import { parseSecurityBlock } from "../vendor/aic-editor-core/security-model.js";
import { SECURITY_FIELD_OPTIONS, SECURITY_FENCE_INFO } from "../vendor/aic-editor-core/field-syntax.js";

test("vendored Authenticator conversion preserves independent masked records", () => {
  const records = [
    { service: "Example", account: "synthetic", secret: "MZXW6YTB", password: "DUMMY-PASSWORD" },
    { service: "Other", account: "synthetic-two", secret: "JBSWY3DP", notes: "" },
  ];
  const result = convertAuthenticatorJson(JSON.stringify(records));
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.accountCount, 2);
  assert.equal(result.blockCount, 1);
  const blocks = result.markdown.split("\n\n").map(block => parseSecurityBlock(block.slice(("```" + SECURITY_FENCE_INFO + "\n").length, -3), SECURITY_FIELD_OPTIONS));
  assert.ok(blocks.every(block => block.ok));
  assert.deepEqual(blocks.flatMap(block => block.model.sections.map(section => section.fields.find(field => field.label === "TOTP"))),
    records.map(record => ({label: "TOTP", value: record.secret, hide: true, kind: "totp"})));
  assert.deepEqual(convertAuthenticatorJson(JSON.stringify([records[0], {...records[1], secret: false}])),
    {ok: false, code: "unsupported_authenticator"});
});

test("vendored import splits overflow into valid v3 blocks without requiring titles", () => {
  const records = Array.from({ length: 17 }, (_, index) => ({service: "Example " + index, account: "synthetic", secret: "MZXW6YTB"}));
  const result = convertAuthenticatorJson(JSON.stringify(records));
  assert.equal(result.ok, true);
  assert.equal(result.blockCount, 2);
  assert.equal(result.accountCount, 17);
  const sections = result.markdown.split("\n\n").flatMap(block => {
    const parsed = parseSecurityBlock(block.slice(("```" + SECURITY_FENCE_INFO + "\n").length, -3), SECURITY_FIELD_OPTIONS);
    assert.equal(parsed.ok, true);
    return parsed.model.sections;
  });
  assert.deepEqual(sections.map(section => section.label), records.map(() => ""));
  assert.deepEqual(sections.map(section => section.fields[0].value), records.map(record => record.service));
});

test("both webview surfaces mount the shared contextual importer and CSS", async () => {
  const main = await readFile(new URL("../src/webview/main.js", import.meta.url), "utf8");
  assert.match(main, /import \{ makeSecurityImportExtension \} from "\.\.\/\.\.\/vendor\/aic-editor-core\/security-import-extension\.js"/u);
  assert.match(main, /makeSecurityImportExtension\(\{ onSave: saveCurrentDraft \}\)/u);
  assert.match(main, /security-import-extension\.css/u);
  assert.match(main, /SECURITY_IMPORT_CSS,/u);
});
