import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["apps/cloud-agent/src/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

try {
  await waitForHealth();
  const health = await get("/api/health");
  assert(health.status === "ok", "health is ok");

  const config = await patch("/api/config", {
    project: {
      healthcheckUrl: "http://127.0.0.1:8080/actuator/health"
    }
  });
  assert(config.project.healthcheckUrl, "config patch works");

  const scan = await post("/api/scans", {});
  assert(scan.id, "scan created");
  assert((await get(`/api/scans/${scan.id}`)).id === scan.id, "scan detail works");

  const incident = await post("/api/incidents", {
    symptom: "支付失败",
    description: "acceptance smoke incident"
  });
  assert(incident.id, "incident created");
  const task = await post(`/api/incidents/${incident.id}/local-fix-task`, {
    repo: { provider: "github", url: "https://github.com/example/payment-api" }
  });
  assert(task.id && task.status === "pending_local_bridge", "local fix task created");

  const deployment = await post("/api/deployments", validDeploySpec());
  assert(deployment.id && deployment.dryRun === true, "dry-run deployment created");
  const detail = await get(`/api/deployments/${deployment.id}`);
  assert(detail.id === deployment.id, "deployment detail works");
  const rollback = await post(`/api/deployments/${deployment.id}/rollback`, {});
  assert(rollback.state === "rolled_back", "rollback works");

  const audit = await get("/api/audit");
  assert(audit.length >= 6, "audit is populated");
  const auditDetail = await get(`/api/audit/${audit[0].id}`);
  assert(auditDetail.id === audit[0].id, "audit detail works");

  console.log(JSON.stringify({
    ok: true,
    health: health.status,
    scan: scan.id,
    incident: incident.id,
    localFixTask: task.id,
    deployment: deployment.id,
    rollback: rollback.status,
    audit: audit.length
  }, null, 2));
} finally {
  child.kill();
}

function validDeploySpec() {
  return {
    service: "payment-api",
    env: "prod",
    runtime: "agent-container",
    artifact: {
      type: "oci_image",
      image: "registry.example.com/payment-api",
      tag: "1.0.0"
    },
    container: {
      ports: [{ container_port: 8080, host_port: 8080, protocol: "tcp" }],
      env: { SPRING_PROFILES_ACTIVE: "prod" },
      secret_refs: []
    },
    healthcheck: {
      type: "http",
      url: "http://127.0.0.1:8080/actuator/health"
    },
    rollback: {
      strategy: "previous_successful_deploy",
      keep_revisions: 5,
      auto_rollback: true
    }
  };
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await get("/api/health");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Cloud Agent did not become healthy");
}

async function get(path) {
  const response = await fetch(`http://127.0.0.1:3717${path}`);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
}

async function post(path, body) {
  return send("POST", path, body);
}

async function patch(path, body) {
  return send("PATCH", path, body);
}

async function send(method, path, body) {
  const response = await fetch(`http://127.0.0.1:3717${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
