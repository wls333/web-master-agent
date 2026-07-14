import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { CloudToolRegistry } from "../src/query/cloud-tools.mjs";
import { registerAgentTools } from "../src/query/agents/agent-tools.mjs";

const apiBase = "http://127.0.0.1:3717";
const child = spawn(process.execPath, ["apps/cloud-agent/src/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "ignore"],
  windowsHide: true
});

try {
  await waitForHealth();
  await rm(".lightops/agent-coordinator-smoke", { recursive: true, force: true });
  const registry = new CloudToolRegistry({ apiBase });
  registerAgentTools(registry, {
    coordinator: undefined
  });

  const plan = await registry.call("agent.plan", {
    objective: "接口 500，需要多 agent 协调诊断、部署审查和本地修复交接"
  });
  assert(plan.result.steps.length >= 3, "coordinator plan should include specialist steps");

  const run = await registry.call("agent.run", {
    agentName: "ops-diagnoser",
    description: "diagnose 500",
    prompt: "Diagnose latest production 500 evidence.",
    mode: "sync",
    isolation: "none"
  });
  assert(run.result.status === "completed", "sync agent should complete");
  assert(run.result.content.includes("ops-diagnoser"), "result should include agent name");

  const deferred = await registry.call("agent.run", {
    agentName: "local-fix-bridge",
    description: "prototype local fix",
    prompt: "Prepare isolated code fix.",
    mode: "async",
    isolation: "worktree"
  });
  assert(deferred.result.status === "deferred_to_local_agent", "worktree isolation should defer to local agent");

  const tasks = await registry.call("agent.tasks", {});
  assert(tasks.result.length >= 1, "agent task should be persisted");

  console.log(JSON.stringify({
    ok: true,
    plannedAgents: plan.result.steps.map((step) => step.agentName),
    runStatus: run.result.status,
    deferredStatus: deferred.result.status,
    persistedTasks: tasks.result.length
  }, null, 2));
} finally {
  child.kill();
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBase}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Cloud Agent did not become healthy");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
