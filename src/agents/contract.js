import { createHash } from "node:crypto";
import { AGENT_GUIDE, AGENT_GUIDE_VERSION } from "../../vendor/aic-editor-core/agent-guide.js";

export const AGENT_MARKER_PATH = Object.freeze([".vscode", "aic-agent.json"]);
export const AGENT_MARKER_SCHEMA = 2;
export const AGENT_GUIDE_HASH = createHash("sha256").update(AGENT_GUIDE).digest("hex");
export const AGENT_GUIDE_PATH = Object.freeze([".vscode", `aic-agent-${AGENT_GUIDE_HASH.slice(0, 16)}.md`]);

export function agentMarker() {
  return {
    schemaVersion: AGENT_MARKER_SCHEMA,
    enabled: true,
    managedBy: "aic-notes",
    guideVersion: AGENT_GUIDE_VERSION,
    guideFile: AGENT_GUIDE_PATH.join("/"),
    guideSha256: AGENT_GUIDE_HASH,
  };
}

export function encodeAgentMarker() {
  return `${JSON.stringify(agentMarker(), null, 2)}\n`;
}

// Accept only known owned markers. Old schema-1 workspaces can migrate explicitly;
// neither marker authorizes running a process or modifying global instructions.
export function validateAgentMarker(value) {
  if (!value || value.enabled !== true || value.managedBy !== "aic-notes") return false;
  if (value.schemaVersion === 1) {
    return Number.isSafeInteger(value.minimumRulesVersion) && value.minimumRulesVersion >= 8 &&
      value.guideCommand === "aic guide --json";
  }
  return value.schemaVersion === AGENT_MARKER_SCHEMA &&
    Number.isSafeInteger(value.guideVersion) && value.guideVersion >= 1 &&
    typeof value.guideSha256 === "string" && /^[a-f0-9]{64}$/u.test(value.guideSha256) &&
    value.guideFile === `.vscode/aic-agent-${value.guideSha256.slice(0, 16)}.md`;
}
