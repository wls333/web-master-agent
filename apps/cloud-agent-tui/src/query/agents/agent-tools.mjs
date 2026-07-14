import { AgentCoordinator } from "./coordinator.mjs";

export function registerAgentTools(registry, { coordinator = new AgentCoordinator({ toolRegistry: registry }) } = {}) {
  registry
    .register({
      name: "agent.list",
      kind: "agent-read",
      risk: "read",
      concurrency: "safe",
      description: "List available LightOps specialist agents and their tool boundaries.",
      inputSchema: objectSchema({}),
      execute: () => coordinator.listAgents()
    })
    .register({
      name: "agent.plan",
      kind: "agent-coordinator",
      risk: "read",
      concurrency: "safe",
      maxOutputChars: 8000,
      description: "Create a coordinator plan that decomposes an operations objective into specialist agent tasks.",
      inputSchema: objectSchema({
        objective: { type: "string", description: "The user objective or incident to decompose." }
      }, ["objective"]),
      execute: (input) => coordinator.plan(input.objective)
    })
    .register({
      name: "agent.run",
      kind: "agent-runtime",
      risk: "write",
      concurrency: "serial",
      maxOutputChars: 12000,
      description: "Run a named specialist agent as a sync or async task. Use worktree isolation only for local-agent handoff metadata.",
      inputSchema: objectSchema({
        agentName: { type: "string", description: "One of: ops-diagnoser, deployment-reviewer, local-fix-bridge, verifier." },
        description: { type: "string", description: "Short task label for UI and task state." },
        prompt: { type: "string", description: "Self-contained task instructions for the worker." },
        mode: { type: "string", enum: ["sync", "async"], description: "sync waits for result; async returns task id immediately." },
        isolation: { type: "string", enum: ["none", "worktree"], description: "worktree is deferred to local agent bridge." }
      }, ["agentName", "prompt"]),
      execute: (input) => coordinator.runAgent({
        agentName: input.agentName,
        description: input.description,
        prompt: input.prompt,
        mode: input.mode || "sync",
        isolation: input.isolation || "none"
      })
    })
    .register({
      name: "agent.tasks",
      kind: "agent-read",
      risk: "read",
      concurrency: "safe",
      maxOutputChars: 12000,
      description: "List persisted specialist agent tasks.",
      inputSchema: objectSchema({}),
      execute: () => coordinator.listTasks()
    })
    .register({
      name: "agent.task.get",
      kind: "agent-read",
      risk: "read",
      concurrency: "safe",
      maxOutputChars: 12000,
      description: "Read a persisted specialist agent task by id.",
      inputSchema: objectSchema({
        id: { type: "string", description: "Agent task id." }
      }, ["id"]),
      execute: (input) => coordinator.getTask(input.id)
    });

  return coordinator;
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
