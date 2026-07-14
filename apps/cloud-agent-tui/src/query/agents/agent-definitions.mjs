export const BUILTIN_AGENT_DEFINITIONS = [
  {
    name: "ops-diagnoser",
    description: "Analyze cloud health evidence, logs, and incident symptoms.",
    tools: ["cloud.state", "cloud.scan", "shell.read"],
    permissionMode: "readOnly",
    background: false,
    maxTurns: 3
  },
  {
    name: "deployment-reviewer",
    description: "Review deployment and rollback risk from Cloud Agent state.",
    tools: ["cloud.state", "cloud.deployments.list"],
    permissionMode: "readOnly",
    background: false,
    maxTurns: 3
  },
  {
    name: "local-fix-bridge",
    description: "Prepare LocalFixTask handoff instructions for Codex or Claude Code.",
    tools: ["cloud.state", "cloud.localFixTask.create"],
    permissionMode: "writeScoped",
    background: false,
    maxTurns: 3
  },
  {
    name: "verifier",
    description: "Summarize verification gaps and safe next checks.",
    tools: ["cloud.state", "cloud.scan"],
    permissionMode: "readOnly",
    background: false,
    maxTurns: 3
  }
];

export function getAgentDefinition(name) {
  return BUILTIN_AGENT_DEFINITIONS.find((agent) => agent.name === name) || null;
}

export function listAgentDefinitions() {
  return BUILTIN_AGENT_DEFINITIONS.map((agent) => ({ ...agent }));
}
