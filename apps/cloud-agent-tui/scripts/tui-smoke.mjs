import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["apps/cloud-agent/src/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "ignore"],
  windowsHide: true
});

try {
  await waitForHealth();
  const state = await get("/api/state");
  assert(state.project, "state has project");
  const scan = await post("/api/scans", {});
  assert(scan.id, "scan works");
  const incident = await post("/api/incidents", { symptom: "接口 500", description: "tui smoke" });
  assert(incident.id, "incident works");
  const task = await post(`/api/incidents/${incident.id}/local-fix-task`, {});
  assert(task.id, "local fix task works");
  const deployment = await post("/api/deployments", deploySpec());
  assert(deployment.id, "deployment works");
  const rollback = await post(`/api/deployments/${deployment.id}/rollback`, {});
  assert(rollback.state === "rolled_back", "rollback works");
  console.log(JSON.stringify({
    ok: true,
    tuiApi: "ready",
    scan: scan.id,
    incident: incident.id,
    localFixTask: task.id,
    deployment: deployment.id,
    rollback: rollback.status
  }, null, 2));
} finally {
  child.kill();
}

function deploySpec() {
  return {
    service: "payment-api",
    env: "prod",
    runtime: "agent-container",
    artifact: { type: "oci_image", image: "registry.example.com/payment-api", tag: "1.0.0" },
    container: {
      ports: [{ container_port: 8080, host_port: 8080, protocol: "tcp" }],
      env: { SPRING_PROFILES_ACTIVE: "prod" },
      secret_refs: []
    },
    healthcheck: { type: "http", url: "http://127.0.0.1:8080/actuator/health" },
    rollback: { strategy: "previous_successful_deploy", keep_revisions: 5, auto_rollback: true }
  };
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
  const response = await fetch(`http://127.0.0.1:3717${path}`);
  if (!response.ok) throw new Error(`${path} failed`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`http://127.0.0.1:3717${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
