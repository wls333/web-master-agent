import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["apps/cloud-agent/src/server.mjs"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk.toString(); });
child.stderr.on("data", (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth();
  const health = await getJson("/api/health");
  assert(health.status === "ok", "health should be ok");

  const scan = await postJson("/api/scans", {});
  assert(scan.id && Array.isArray(scan.findings), "scan should return findings");
  const scans = await getJson("/api/scans");
  assert(Array.isArray(scans) && scans.length > 0, "scans list should return records");

  const incident = await postJson("/api/incidents", {
    symptom: "接口 500",
    description: "smoke test incident"
  });
  assert(incident.id && incident.status === "open", "incident should be created");

  const deployment = await postJson("/api/deployments", {
    service: "payment-api",
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
  });
  assert(deployment.id && deployment.dryRun === true, "deployment should dry-run");
  const deploymentDetail = await getJson(`/api/deployments/${deployment.id}`);
  assert(deploymentDetail.id === deployment.id, "deployment detail should resolve");
  const rollback = await postJson(`/api/deployments/${deployment.id}/rollback`, {});
  assert(rollback.id === deployment.id && rollback.state === "rolled_back", "rollback should be recorded");
  const audit = await getJson("/api/audit");
  assert(Array.isArray(audit) && audit.length > 0, "audit should return records");

  console.log(JSON.stringify({
    ok: true,
    health: health.status,
    scan: scan.id,
    findings: scan.findings.length,
    incident: incident.id,
    deployment: deployment.id,
    rollback: rollback.status,
    audit: audit.length
  }, null, 2));
} finally {
  child.kill();
}

async function waitForHealth() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      await getJson("/api/health");
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`Cloud Agent did not become healthy. Output:\n${output}`);
}

async function getJson(path) {
  const response = await fetch(`http://127.0.0.1:3717${path}`);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
}

async function postJson(path, body) {
  const response = await fetch(`http://127.0.0.1:3717${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
