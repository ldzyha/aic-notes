import test from "node:test";
import assert from "node:assert/strict";
import { DraftSession, AIC_EDITOR_CORE_VERSION } from "../vendor/aic-editor-core/draft-session.js";

test("shared draft core commits only explicit boundaries", () => {
  const draft = new DraftSession();
  assert.equal(AIC_EDITOR_CORE_VERSION, "1.0.0");
  draft.hydrate("base", 3);
  draft.edit("base + local");
  assert.equal(draft.external("remote", 4), false);
  assert.deepEqual(draft.begin("explicit"), {
    text: "base + local",
    generation: 3,
    reason: "explicit",
  });
  assert.equal(draft.begin("explicit"), null);
  draft.acknowledge({ text: "base + local", generation: 3, saved: false });
  assert.equal(draft.dirty, true);
  const retry = draft.begin("explicit");
  draft.acknowledge({ ...retry, saved: true });
  assert.equal(draft.dirty, false);
});
