import { spawn } from "node:child_process";
import { rm, readdir, readFile } from "node:fs/promises";
import { SessionStore } from "../src/query/session-store.mjs";
import { CloudToolRegistry } from "../src/query/cloud-tools.mjs";
import { QueryEngine } from "../src/query/query-engine.mjs";

const apiBase = "http://127.0.0.1:3717";
const child = spawn(process.execPath, ["apps/cloud-agent/src/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "ignore"],
  windowsHide: true
});

try {
  await waitForHealth();
  const sessionRoot = ".lightops/query-engine-smoke";
  await rm(sessionRoot, { recursive: true, force: true });
  const sessionStore = new SessionStore({ rootDir: sessionRoot });
  const toolRegistry = new CloudToolRegistry({ apiBase });
  const engine = await new QueryEngine({ sessionStore, toolRegistry, maxTurns: 4 }).restore();

  const result = await engine.submitMessage("帮我体检一下云端项目状态");
  assert(result.reason === "completed", "query should complete");

  await post("/api/incidents", { symptom: "接口 500", description: "query engine smoke" });
  const fixResult = await engine.submitMessage("根据最近事故生成本地修复任务");
  assert(fixResult.reason === "completed", "fix query should complete");
  const tasks = await get("/api/local-fix-tasks");
  assert(tasks.length >= 1, "local fix task should be created by query engine");

  const files = await readdir(sessionRoot);
  assert(files.length === 1, "one transcript should be written");
  const transcript = await readFile(`${sessionRoot}/${files[0]}`, "utf8");
  assert(transcript.includes("tool_use"), "transcript should include tool_use");
  assert(transcript.includes("tool_result"), "transcript should include tool_result");
  assert(transcript.includes("termination"), "transcript should include termination");

  console.log(JSON.stringify({
    ok: true,
    session: engine.sessionId,
    transcript: files[0],
    messages: engine.messages.length,
    toolCalls: engine.totalUsage.toolCalls,
    localFixTasks: tasks.length
  }, null, 2));
} finally {
  child.kill();
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await get("/api/health");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Cloud Agent did not become healthy");
}

async function get(path) {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) throw new Error(`${path} failed`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
