import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { convertAuthenticatorJson } from "../vendor/aic-editor-core/security-import.js";
import { parseSecurityBlock } from "../vendor/aic-editor-core/security-model.js";

test("vendored Authenticator conversion preserves independent masked records", () => {
  const records = [
    { service: "Example", account: "synthetic", secret: "MZXW6YTB", password: "DUMMY-PASSWORD" },
    { service: "Other", account: "synthetic-two", secret: "JBSWY3DP", notes: "" },
  ];
  const result = convertAuthenticatorJson(JSON.stringify(records));
  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  const blocks = result.markdown.split("\n\n").map(block => parseSecurityBlock(block.slice("```aic-security v2\n".length, -3), { fieldSyntax: "pipes" }));
  assert.ok(blocks.every(block => block.ok));
  assert.deepEqual(blocks.map(block => block.model.sections[0].fields.find(field => field.label === "TOTP")),
    records.map(record => ({label: "TOTP", value: record.secret, hide: true, kind: "totp"})));
  assert.deepEqual(convertAuthenticatorJson(JSON.stringify([records[0], {...records[1], secret: false}])),
    {ok: false, code: "unsupported_authenticator"});
});

test("both webview surfaces mount the shared contextual importer and CSS", async () => {
  const main = await readFile(new URL("../src/webview/main.js", import.meta.url), "utf8");
  assert.match(main, /import \{ makeSecurityImportExtension \} from "\.\.\/\.\.\/vendor\/aic-editor-core\/security-import-extension\.js"/u);
  assert.match(main, /makeSecurityImportExtension\(\{ onSave: saveCurrentDraft \}\)/u);
  assert.match(main, /security-import-extension\.css/u);
  assert.match(main, /SECURITY_IMPORT_CSS,/u);
});
