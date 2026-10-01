import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { AGENT_GUIDE } from "../vendor/aic-editor-core/agent-guide.js";
import {
  agentGuideIdentity,
  agentMarker,
  encodeAgentMarker,
  validateAgentMarker,
} from "../src/agents/contract.js";
test("marker binds bundled instructions without an executable", async () => {
  const marker = JSON.parse(await encodeAgentMarker());
  assert.equal(marker.guideFile, (await agentGuideIdentity()).path.join("/"));
  assert.equal(
    marker.guideSha256,
    createHash("sha256").update(AGENT_GUIDE).digest("hex"),
  );
  assert.equal(validateAgentMarker(marker), true);
  assert.equal(marker.guideCommand, undefined);
});
test("only known owned legacy markers allow explicit migration", () => {
  const marker = {
    schemaVersion: 1,
    enabled: true,
    managedBy: "aic-notes",
    minimumRulesVersion: 8,
    guideCommand: "aic guide --json",
  };
  assert.equal(validateAgentMarker(marker), true);
  assert.equal(
    validateAgentMarker({ ...marker, guideCommand: "custom" }),
    false,
  );
});
test("foreign markers and unsafe paths are rejected", async () => {
  for (const patch of [
    { managedBy: "owner" },
    { guideFile: "../../AGENTS.md" },
    { guideSha256: "invalid" },
    { schemaVersion: 99 },
  ])
    assert.equal(
      validateAgentMarker({ ...(await agentMarker()), ...patch }),
      false,
    );
});
