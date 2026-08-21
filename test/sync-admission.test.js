import test from "node:test";
import assert from "node:assert/strict";
import { noteBody, syncAdmission } from "../src/sync/admission.js";

const frontmatter = `---
title: app.js
level: file-note
status: live
updated: 2026-08-21
---
`;

test("sync admission rejects whitespace and valid-frontmatter-only notes", () => {
  assert.deepEqual(syncAdmission(" \n\t"), { admit: false, reason: "empty" });
  assert.deepEqual(syncAdmission(`${frontmatter}\n`), { admit: false, reason: "empty" });
  assert.deepEqual(syncAdmission("---\r\n---\r\n"), { admit: false, reason: "empty" });
  assert.equal(noteBody(`${frontmatter}\ntext\n`), "\ntext\n");
});

test("sync admission rejects exact default and custom placeholder bodies independent of metadata", () => {
  const generated = `${frontmatter}\n## Todo\n\n- [ ]\n\n## Open questions\n\n- [ ]\n`;
  const persisted = generated.replace("updated: 2026-08-21", "updated: 2026-08-22");
  assert.deepEqual(syncAdmission(persisted, generated), { admit: false, reason: "placeholder" });

  const custom = `${frontmatter}\n# app.js\n\nWrite the first decision.\n`;
  const customPersisted = custom.replace("status: live", "status: draft");
  assert.deepEqual(syncAdmission(customPersisted, custom), { admit: false, reason: "placeholder" });
  assert.deepEqual(syncAdmission(generated.replaceAll("\n", "\r\n"), generated), {
    admit: false,
    reason: "placeholder",
  });
});

test("sync admission treats heading plus empty tasks and legacy cleared checklist as empty scaffold", () => {
  for (const body of [
    "- [ ]\n",
    "## Todo\n\n- [ ]\n\n## Open questions\n\n- [ ]\n",
    "1. [ ]\n",
  ]) {
    assert.deepEqual(syncAdmission(`${frontmatter}${body}`), { admit: false, reason: "empty" });
  }
});

test("sync admission accepts checked tasks, task text, prose, and body after empty frontmatter", () => {
  for (const markdown of [
    `${frontmatter}## Todo\n\n- [x]\n`,
    `${frontmatter}## Todo\n\n- [ ] implement it\n`,
    `${frontmatter}## Decision\n\nUse the bridge.\n`,
    "---\n---\nbody\n",
  ]) {
    assert.deepEqual(syncAdmission(markdown), { admit: true, reason: "substantive" });
  }
});
