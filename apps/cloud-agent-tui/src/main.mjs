#!/usr/bin/env node
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { SessionStore } from "./query/session-store.mjs";
import { CloudToolRegistry } from "./query/cloud-tools.mjs";
import { QueryEngine } from "./query/query-engine.mjs";

const API = process.env.LIGHTOPS_API || "http://127.0.0.1:3717";
const rl = readline.createInterface({ input, output });

const state = {
  last: null,
  logs: []
};
const sessionStore = new SessionStore();
const toolRegistry = new CloudToolRegistry({ apiBase: API });
const queryEngine = await new QueryEngine({
  sessionStore,
  toolRegistry,
  sessionId: await sessionStore.latestSessionId()
}).restore();

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

async function main() {
  await refresh("Connected to Cloud Agent");
  while (true) {
    const line = (await rl.question(`${colors.cyan}lightops>${colors.reset} `)).trim();
    if (!line) continue;
    if (["/quit", "/exit", "exit", "quit"].includes(line)) break;
    await dispatch(line).catch((error) => log(`ERROR ${error.message}`, "red"));
  }
  rl.close();
}

async function dispatch(line) {
  const [command, ...args] = line.split(/\s+/);
  switch (command) {
    case "/help":
    case "help":
      help();
      return;
    case "/refresh":
    case "refresh":
      await refresh("State refreshed");
      return;
    case "/scan":
    case "scan":
      await runScan();
      return;
    case "/incident":
    case "incident":
      await incidentCommand(args);
      return;
    case "/fix":
    case "fix":
      await createLocalFixTask();
      return;
    case "/deploy":
    case "deploy":
      await deployWizard();
      return;
    case "/rollback":
    case "rollback":
      await rollbackLatest();
      return;
    case "/audit":
    case "audit":
      await showAudit();
      return;
    case "/config":
    case "config":
      await showConfig();
      return;
    default:
      await queryEngine.submitMessage(line);
      await refresh();
  }
}

async function refresh(message) {
  state.last = await api("GET", "/api/state");
  if (message) log(message, "green");
  render();
}

function render() {
  clear();
  const s = state.last || {};
  const scan = s.latestScan;
  const project = s.project || {};
  header("LightOps Cloud Agent TUI");
  row("Project", `${project.name || project.id || "unconfigured"} (${project.runtime || "unknown"})`);
  row("Health", scan ? `${scoreColor(scan.score)}${scan.score}${colors.reset} ${scan.summary}` : "No scan yet");
  row("Incidents", String(s.incidents?.length || 0));
  row("Deployments", String(s.deployments?.length || 0));
  row("LocalFixTasks", String(s.localFixTasks?.length || 0));
  divider();
  section("Findings");
  for (const finding of (scan?.findings || []).slice(0, 6)) {
    const mark = finding.status === "critical" ? "!" : finding.status === "warning" ? "*" : "-";
    console.log(`${statusColor(finding.status)}${mark} ${finding.status.padEnd(8)}${colors.reset} ${finding.message}`);
  }
  if (!scan) console.log(`${colors.gray}Run /scan to collect readiness evidence.${colors.reset}`);
  divider();
  section("Recent Activity");
  for (const item of (s.audit || []).slice(0, 5)) {
    console.log(`${colors.gray}${item.createdAt}${colors.reset} ${item.action} ${item.status}`);
  }
  divider();
  console.log(`${colors.dim}/scan  /incident create  /fix  /deploy  /rollback  /audit  /config  /help  /quit${colors.reset}`);
  console.log("");
}

async function runScan() {
  log("Running readiness scan...", "cyan");
  const scan = await api("POST", "/api/scans", {});
  log(`Scan completed: ${scan.id} (${scan.summary})`, "green");
  await refresh();
}

async function incidentCommand(args) {
  if (args[0] !== "create") {
    const incidents = await api("GET", "/api/incidents");
    printList("Incidents", incidents, (item) => `${item.id} ${item.severity} ${item.status} ${item.symptom}`);
    return;
  }
  const symptom = await ask("Symptom", "接口 500");
  const description = await askMultiline("Description");
  const incident = await api("POST", "/api/incidents", { symptom, description });
  log(`Incident created: ${incident.id}`, "green");
  await refresh();
}

async function createLocalFixTask() {
  const incidents = await api("GET", "/api/incidents");
  if (!incidents.length) {
    log("No incident found. Create one with /incident create", "yellow");
    return;
  }
  const incident = await choose("Select incident", incidents, (item) => `${item.id} ${item.severity} ${item.symptom}`);
  const objective = await ask("Objective", `根据线上证据修复：${incident.symptom}`);
  const task = await api("POST", `/api/incidents/${incident.id}/local-fix-task`, { objective });
  log(`LocalFixTask created: ${task.id}`, "green");
  await refresh();
}

async function deployWizard() {
  header("DeploySpec Wizard");
  const service = await ask("Service", state.last?.project?.id || "payment-api");
  const image = await ask("Image", "registry.example.com/payment-api");
  const tag = await ask("Tag", "1.0.0");
  const hostPort = Number(await ask("Host port", "8080"));
  const containerPort = Number(await ask("Container port", "8080"));
  const healthUrl = await ask("Healthcheck URL", `http://127.0.0.1:${hostPort}/actuator/health`);
  const spec = {
    service,
    env: "prod",
    runtime: "agent-container",
    artifact: { type: "oci_image", image, tag },
    container: {
      ports: [{ container_port: containerPort, host_port: hostPort, protocol: "tcp" }],
      env: { SPRING_PROFILES_ACTIVE: "prod" },
      secret_refs: []
    },
    healthcheck: { type: "http", url: healthUrl },
    rollback: { strategy: "previous_successful_deploy", keep_revisions: 5, auto_rollback: true }
  };
  const validation = await api("POST", "/api/deployments/validate", spec, { allow422: true });
  if (!validation.ok) {
    log(`DeploySpec blocked: ${validation.errors.join("; ")}`, "red");
    return;
  }
  if (validation.warnings?.length) log(`Warnings: ${validation.warnings.join("; ")}`, "yellow");
  const confirmation = await ask("Type deploy prod to continue", "");
  if (confirmation !== "deploy prod") {
    log("Deployment cancelled", "yellow");
    return;
  }
  const deployment = await api("POST", "/api/deployments", spec);
  log(`Deployment recorded: ${deployment.id} ${deployment.status}`, "green");
  await refresh();
}

async function rollbackLatest() {
  const deployments = await api("GET", "/api/deployments");
  if (!deployments.length) {
    log("No deployment found", "yellow");
    return;
  }
  const deployment = await choose("Select deployment", deployments, (item) => `${item.id} ${item.service} ${item.state} ${item.revision}`);
  const confirmation = await ask(`Type rollback ${deployment.service} to continue`, "");
  if (confirmation !== `rollback ${deployment.service}`) {
    log("Rollback cancelled", "yellow");
    return;
  }
  const result = await api("POST", `/api/deployments/${deployment.id}/rollback`, {});
  log(`Rollback recorded: ${result.id} ${result.status}`, "green");
  await refresh();
}

async function showAudit() {
  const audit = await api("GET", "/api/audit");
  printList("Audit", audit.slice(0, 15), (item) => `${item.id} ${item.action} ${item.status}`);
}

async function showConfig() {
  const config = await api("GET", "/api/config");
  console.log(JSON.stringify(config, null, 2));
}

function help() {
  console.log(`
Commands:
  /scan              Run readiness scan
  /incident          List incidents
  /incident create   Create business incident
  /fix               Generate LocalFixTask from incident
  /deploy            DeploySpec wizard and dry-run/controlled deploy
  /rollback          Roll back selected deployment
  /audit             Show audit events
  /config            Show redacted config
  natural language   Ask the agent, e.g. "帮我体检" or "支付失败，生成修复任务"
  /refresh           Refresh dashboard
  /quit              Exit
`);
}

async function api(method, path, body, options = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok && !(options.allow422 && response.status === 422)) {
    throw new Error(payload?.error?.message || payload?.error || `${method} ${path} failed`);
  }
  return payload;
}

async function ask(label, fallback) {
  const answer = await rl.question(`${label}${fallback ? ` (${fallback})` : ""}: `);
  return answer.trim() || fallback;
}

async function askMultiline(label) {
  console.log(`${label} (finish with a single "."):`);
  const lines = [];
  while (true) {
    const line = await rl.question("> ");
    if (line.trim() === ".") break;
    lines.push(line);
  }
  return lines.join("\n");
}

async function choose(label, items, format) {
  console.log(label);
  items.forEach((item, index) => console.log(`  ${index + 1}. ${format(item)}`));
  const answer = Number(await ask("Choose", "1"));
  return items[Math.max(0, Math.min(items.length - 1, answer - 1))];
}

function printList(title, items, format) {
  section(title);
  if (!items.length) console.log(`${colors.gray}empty${colors.reset}`);
  for (const item of items) console.log(`- ${format(item)}`);
}

function header(text) {
  console.log(`${colors.bold}${text}${colors.reset}`);
  divider();
}

function section(text) {
  console.log(`${colors.bold}${text}${colors.reset}`);
}

function row(label, value) {
  console.log(`${colors.gray}${label.padEnd(14)}${colors.reset}${value}`);
}

function divider() {
  console.log(`${colors.gray}${"─".repeat(72)}${colors.reset}`);
}

function clear() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function log(message, color = "reset") {
  state.logs.push({ message, color });
  console.log(`${colors[color] || ""}${message}${colors.reset}`);
}

function statusColor(status) {
  if (status === "critical") return colors.red;
  if (status === "warning") return colors.yellow;
  if (status === "ok") return colors.green;
  return colors.cyan;
}

function scoreColor(score) {
  if (score >= 80) return colors.green;
  if (score >= 50) return colors.yellow;
  return colors.red;
}

main().catch((error) => {
  console.error(`${colors.red}${error.message}${colors.reset}`);
  console.error("Is Cloud Agent running? Start it with: node apps/cloud-agent/src/server.mjs");
  process.exit(1);
});
