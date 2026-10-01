import { sha256 } from "../host-runtime.js";
import {
  AGENT_GUIDE,
  AGENT_GUIDE_VERSION,
} from "../../vendor/aic-editor-core/agent-guide.js";

export const AGENT_MARKER_PATH = Object.freeze([".vscode", "aic-agent.json"]);
export const AGENT_MARKER_SCHEMA = 2;
let identity;
export function agentGuideIdentity() {
  return (identity ??= sha256(AGENT_GUIDE).then((hash) =>
    Object.freeze({
      hash,
      path: Object.freeze([".vscode", `aic-agent-${hash.slice(0, 16)}.md`]),
    }),
  ));
}

export async function agentMarker() {
  const { hash, path } = await agentGuideIdentity();
  return {
    schemaVersion: AGENT_MARKER_SCHEMA,
    enabled: true,
    managedBy: "aic-notes",
    guideVersion: AGENT_GUIDE_VERSION,
    guideFile: path.join("/"),
    guideSha256: hash,
  };
}

export async function encodeAgentMarker() {
  return `${JSON.stringify(await agentMarker(), null, 2)}\n`;
}

// Accept only known owned markers. Old schema-1 workspaces can migrate explicitly;
// neither marker authorizes running a process or modifying global instructions.
export function validateAgentMarker(value) {
  if (!value || value.enabled !== true || value.managedBy !== "aic-notes")
    return false;
  if (value.schemaVersion === 1) {
    return (
      Number.isSafeInteger(value.minimumRulesVersion) &&
      value.minimumRulesVersion >= 8 &&
      value.guideCommand === "aic guide --json"
    );
  }
  return (
    value.schemaVersion === AGENT_MARKER_SCHEMA &&
    Number.isSafeInteger(value.guideVersion) &&
    value.guideVersion >= 1 &&
    typeof value.guideSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.guideSha256) &&
    value.guideFile === `.vscode/aic-agent-${value.guideSha256.slice(0, 16)}.md`
  );
}
