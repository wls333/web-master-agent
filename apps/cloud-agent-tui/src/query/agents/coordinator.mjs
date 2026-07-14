import { getAgentDefinition, listAgentDefinitions } from "./agent-definitions.mjs";
import { AgentTaskStore } from "./agent-task-store.mjs";

export class AgentCoordinator {
  constructor({ toolRegistry, taskStore = new AgentTaskStore() } = {}) {
    this.toolRegistry = toolRegistry;
    this.taskStore = taskStore;
  }

  listAgents() {
    return listAgentDefinitions();
  }

  plan(objective) {
    const lower = String(objective || "").toLowerCase();
    const steps = [];
    steps.push(step("ops-diagnoser", "Collect production evidence and summarize the most likely runtime failure mode."));
    if (/deploy|rollback|发布|部署|回滚|镜像|版本/i.test(lower)) {
      steps.push(step("deployment-reviewer", "Review deployment records, rollback options, and release safety checks."));
    }
    if (/fix|bug|修复|代码|codex|claude|本地/i.test(lower)) {
      steps.push(step("local-fix-bridge", "Prepare a LocalFixTask with enough evidence for the local coding agent."));
    }
    steps.push(step("verifier", "Define verification gaps and the next safe check before production changes."));
    return {
      objective,
      mode: "coordinator",
      topology: "star",
      steps,
      notes: [
        "Coordinator summarizes worker outputs instead of forwarding them blindly.",
        "Cloud workers use dedicated tools; local code changes should be delegated through LocalFixTask.",
        "Worktree isolation is reserved for future local-agent execution, not cloud-host production mutation."
      ]
    };
  }

  async runAgent({ agentName, description, prompt, mode = "sync", isolation = "none" }) {
    const definition = getAgentDefinition(agentName);
    if (!definition) throw new Error(`Unknown agent: ${agentName}`);
    if (isolation === "worktree") {
      return this.createWorktreeDeferredTask({ definition, description, prompt, mode });
    }
    const task = await this.taskStore.createTask({
      agentName,
      description: description || definition.description,
      prompt,
      mode,
      isolation
    });
    if (mode === "async") {
      void this.runTaskLifecycle(task, definition);
      return {
        status: "async_launched",
        agentId: task.id,
        description: task.description,
        outputFile: this.taskStore.pathFor(task.id),
        canReadOutputFile: true
      };
    }
    return this.runTaskLifecycle(task, definition);
  }

  async runTaskLifecycle(task, definition) {
    try {
      await this.taskStore.markRunning(task.id);
      await this.taskStore.appendProgress(task.id, `Started ${definition.name}`);
      const result = await this.executeSpecialist(task, definition);
      const completed = await this.taskStore.complete(task.id, result);
      return {
        status: "completed",
        agentId: task.id,
        content: result.content,
        usage: result.usage,
        task: completed
      };
    } catch (error) {
      const failed = await this.taskStore.fail(task.id, error);
      return {
        status: "failed",
        agentId: task.id,
        error: error.message,
        task: failed
      };
    }
  }

  async executeSpecialist(task, definition) {
    const availableTools = new Set(definition.tools);
    const evidence = {};
    if (availableTools.has("cloud.state")) {
      evidence.state = await this.toolRegistry.call("cloud.state", {});
    }
    if (definition.name === "ops-diagnoser" && availableTools.has("cloud.scan")) {
      evidence.scan = await this.toolRegistry.call("cloud.scan", {});
    }
    if (definition.name === "deployment-reviewer" && availableTools.has("cloud.deployments.list")) {
      evidence.deployments = await this.toolRegistry.call("cloud.deployments.list", {});
    }
    if (definition.name === "local-fix-bridge" && availableTools.has("cloud.localFixTask.create")) {
      evidence.localFixTaskHint = "Create LocalFixTask only when the coordinator has an incident id or the user explicitly requests handoff.";
    }
    await this.taskStore.appendProgress(task.id, "Evidence collected");
    return summarizeSpecialistResult({ task, definition, evidence });
  }

  async listTasks() {
    return this.taskStore.listTasks();
  }

  async getTask(id) {
    return this.taskStore.getTask(id);
  }

  createWorktreeDeferredTask({ definition, description, prompt, mode }) {
    return {
      status: "deferred_to_local_agent",
      agentName: definition.name,
      description: description || definition.description,
      prompt,
      mode,
      isolation: "worktree",
      reason: "Cloud TUI does not mutate local source trees. A local Codex/Claude Code bridge should create a git worktree and execute this task."
    };
  }
}

function step(agentName, objective) {
  const definition = getAgentDefinition(agentName);
  return {
    agentName,
    description: definition?.description || agentName,
    objective,
    mode: "async",
    isolation: "none"
  };
}

function summarizeSpecialistResult({ task, definition, evidence }) {
  const lines = [
    `${definition.name} completed: ${task.description}`,
    `Objective: ${task.prompt}`
  ];
  if (evidence.scan?.result) {
    lines.push(`Scan score: ${evidence.scan.result.score}; summary: ${evidence.scan.result.summary}`);
  }
  if (evidence.state?.result?.latestScan) {
    lines.push(`Latest health: ${evidence.state.result.latestScan.score} ${evidence.state.result.latestScan.summary}`);
  }
  if (evidence.deployments?.result) {
    lines.push(`Deployments observed: ${evidence.deployments.result.length}`);
  }
  if (evidence.localFixTaskHint) lines.push(evidence.localFixTaskHint);
  return {
    content: lines.join("\n"),
    evidence,
    usage: {
      toolUses: Object.keys(evidence).length,
      synthetic: true
    }
  };
}
