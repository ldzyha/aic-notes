export const AGENT_MARKER_PATH = Object.freeze([".vscode", "aic-agent.json"]);
export const AGENT_MARKER_SCHEMA = 1;
export const MIN_AIC_RULES_VERSION = 8;

export function agentMarker(rulesVersion = MIN_AIC_RULES_VERSION) {
  return {
    schemaVersion: AGENT_MARKER_SCHEMA,
    enabled: true,
    managedBy: "aic-notes",
    minimumRulesVersion: rulesVersion,
    guideCommand: "aic guide --json",
    context: {
      resolver: "aic context resolve --json",
      instructionEntrypoint: "AGENTS.md",
      ownerNotes: "*.note.md",
      taskArtifacts: "*.ai.md",
    },
  };
}

export function encodeAgentMarker(rulesVersion) {
  return `${JSON.stringify(agentMarker(rulesVersion), null, 2)}\n`;
}

export function validateAgentMarker(value) {
  return Boolean(
    value &&
      value.schemaVersion === AGENT_MARKER_SCHEMA &&
      value.enabled === true &&
      value.managedBy === "aic-notes" &&
      Number.isSafeInteger(value.minimumRulesVersion) &&
      value.minimumRulesVersion >= MIN_AIC_RULES_VERSION &&
      value.guideCommand === "aic guide --json",
  );
}

export function classifyRulesStatus(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.rulesVersion) ||
    value.rulesVersion < MIN_AIC_RULES_VERSION ||
    !["current", "needsSync"].includes(value.state) ||
    !Array.isArray(value.targets)
  ) {
    return { state: "versionSkew", unmanaged: false };
  }
  return {
    state: value.state,
    unmanaged: value.targets.some((target) => target?.state === "unmanaged"),
    rulesVersion: value.rulesVersion,
    requiresNewSession: Boolean(value.requiresNewSession),
  };
}
