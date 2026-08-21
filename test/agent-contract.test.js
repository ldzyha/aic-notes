import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_MARKER_PATH,
  MIN_AIC_RULES_VERSION,
  agentMarker,
  classifyRulesStatus,
  encodeAgentMarker,
  validateAgentMarker,
} from "../src/agents/contract.js";

test("portable agent marker points to canonical AIC context without copying rules", () => {
  assert.deepEqual(AGENT_MARKER_PATH, [".vscode", "aic-agent.json"]);
  const marker = agentMarker();
  assert.equal(marker.minimumRulesVersion, MIN_AIC_RULES_VERSION);
  assert.equal(marker.guideCommand, "aic guide --json");
  assert.deepEqual(marker.context, {
    resolver: "aic context resolve --json",
    instructionEntrypoint: "AGENTS.md",
    ownerNotes: "*.note.md",
    taskArtifacts: "*.ai.md",
  });
  assert.equal(validateAgentMarker(JSON.parse(encodeAgentMarker())), true);
  assert.doesNotMatch(encodeAgentMarker(), /instructionPack|English practice|GO.*DONE/su);
});

test("agent marker rejects foreign and stale contracts", () => {
  assert.equal(validateAgentMarker({ ...agentMarker(), managedBy: "owner" }), false);
  assert.equal(validateAgentMarker({ ...agentMarker(), minimumRulesVersion: 7 }), false);
  assert.equal(validateAgentMarker({ ...agentMarker(), guideCommand: "custom guide" }), false);
});

test("rules status distinguishes current, safe sync, unmanaged, and version skew", () => {
  const base = {
    schemaVersion: 1,
    rulesVersion: MIN_AIC_RULES_VERSION,
    targets: [{ id: "codex", state: "current" }],
  };
  assert.deepEqual(classifyRulesStatus({ ...base, state: "current" }), {
    state: "current",
    unmanaged: false,
    rulesVersion: MIN_AIC_RULES_VERSION,
    requiresNewSession: false,
  });
  assert.equal(
    classifyRulesStatus({ ...base, state: "needsSync", targets: [{ state: "unmanaged" }] }).unmanaged,
    true,
  );
  assert.equal(classifyRulesStatus({ ...base, rulesVersion: 7, state: "current" }).state, "versionSkew");
});
