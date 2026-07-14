const $ = (selector) => document.querySelector(selector);

const state = {
  latest: null
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "request failed");
  }
  return payload;
}

async function refresh() {
  const payload = await api("/api/state");
  state.latest = payload;
  render(payload);
}

function render(payload) {
  $("#projectName").textContent = payload.project?.name || payload.project?.id || "未配置";
  $("#agentInfo").textContent = `${payload.agent.name} · ${payload.agent.bindHost}:${payload.agent.port}`;
  $("#incidentCount").textContent = payload.incidents.length;
  $("#deployCount").textContent = payload.deployments.length;

  const scan = payload.latestScan;
  $("#score").textContent = scan ? scan.score : "--";
  $("#summary").textContent = scan ? scan.summary : "等待首次体检";

  renderFindings(scan?.findings || []);
  renderAudit(payload.audit || []);
  renderDeployments(payload.deployments || []);
  renderIncidents(payload.incidents || []);
  renderLocalFixTasks(payload.localFixTasks || []);
}

function renderFindings(findings) {
  const host = $("#findings");
  if (!findings.length) {
    host.className = "list empty";
    host.textContent = "暂无体检结果";
    return;
  }
  host.className = "list";
  host.innerHTML = findings.map((item) => `
    <div class="item">
      <div class="item-title">
        <span>${escapeHtml(item.message)}</span>
        <span class="badge ${item.status}">${item.status}</span>
      </div>
      <p>${escapeHtml(item.analyzer)} · confidence ${Math.round(item.confidence * 100)}%</p>
    </div>
  `).join("");
}

function renderAudit(items) {
  const host = $("#audit");
  if (!items.length) {
    host.className = "list empty";
    host.textContent = "暂无事件";
    return;
  }
  host.className = "list";
  host.innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-title">
        <span>${escapeHtml(item.action)}</span>
        <span class="badge info">${escapeHtml(item.status)}</span>
      </div>
      <p>${new Date(item.createdAt).toLocaleString()}</p>
    </div>
  `).join("");
}

function renderDeployments(items) {
  const host = $("#deployments");
  if (!items.length) {
    host.className = "list empty";
    host.textContent = "暂无部署";
    return;
  }
  host.className = "list";
  host.innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-title">
        <span>${escapeHtml(item.service)} · ${escapeHtml(item.revision || "no-revision")}</span>
        <span class="badge ${item.state === "succeeded" ? "ok" : "info"}">${escapeHtml(item.state || item.status)}</span>
      </div>
      <p>${escapeHtml(item.runtime)} · ${new Date(item.createdAt).toLocaleString()}</p>
    </div>
  `).join("");
}

function renderIncidents(items) {
  const host = $("#incidents");
  if (!items.length) {
    host.className = "list empty";
    host.textContent = "暂无事故";
    return;
  }
  host.className = "list";
  host.innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-title">
        <span>${escapeHtml(item.symptom)}</span>
        <span class="badge warning">${escapeHtml(item.severity)}</span>
      </div>
      <p>${escapeHtml(item.status)} · ${new Date(item.createdAt).toLocaleString()}</p>
    </div>
  `).join("");
}

function renderLocalFixTasks(items) {
  const host = $("#localFixTasks");
  if (!items.length) {
    host.className = "list empty";
    host.textContent = "暂无本地修复任务";
    return;
  }
  host.className = "list";
  host.innerHTML = items.map((item) => `
    <div class="item">
      <div class="item-title">
        <span>${escapeHtml(item.objective)}</span>
        <span class="badge info">${escapeHtml(item.status)}</span>
      </div>
      <p>${escapeHtml(item.id)} · incident ${escapeHtml(item.incidentId)}</p>
    </div>
  `).join("");
}

async function runScan() {
  const button = $("#scanBtn");
  button.disabled = true;
  button.textContent = "体检中...";
  try {
    await api("/api/scans", { method: "POST", body: "{}" });
    await refresh();
  } finally {
    button.disabled = false;
    button.textContent = "一键体检";
  }
}

async function createBug() {
  const symptom = $("#symptom").value;
  const description = $("#description").value;
  await api("/api/incidents", {
    method: "POST",
    body: JSON.stringify({ symptom, description })
  });
  await refresh();
}

async function deployDryRun() {
  const spec = {
    service: state.latest?.project?.id || "demo-service",
    runtime: "agent-container",
    artifact: {
      type: "oci_image",
      image: $("#image").value,
      tag: $("#tag").value
    },
    container: {
      ports: [{ container_port: 8080, host_port: 8080, protocol: "tcp" }],
      env: { SPRING_PROFILES_ACTIVE: "prod" },
      secret_refs: []
    },
    healthcheck: {
      type: "http",
      url: $("#healthUrl").value
    },
    rollback: {
      strategy: "previous_successful_deploy",
      keep_revisions: 5,
      auto_rollback: true
    }
  };

  await api("/api/deployments/validate", {
    method: "POST",
    body: JSON.stringify(spec)
  });
  await api("/api/deployments", {
    method: "POST",
    body: JSON.stringify(spec)
  });
  await refresh();
}

async function rollbackLatest() {
  const latest = state.latest?.deployments?.[0];
  if (!latest) return;
  await api(`/api/deployments/${latest.id}/rollback`, {
    method: "POST",
    body: "{}"
  });
  await refresh();
}

async function createLocalFixTask() {
  const latest = state.latest?.incidents?.[0];
  if (!latest) return;
  await api(`/api/incidents/${latest.id}/local-fix-task`, {
    method: "POST",
    body: JSON.stringify({
      objective: `请根据线上证据修复：${latest.symptom}`
    })
  });
  await refresh();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("#scanBtn").addEventListener("click", runScan);
$("#bugBtn").addEventListener("click", createBug);
$("#deployBtn").addEventListener("click", deployDryRun);
$("#rollbackBtn").addEventListener("click", rollbackLatest);
$("#localFixBtn").addEventListener("click", createLocalFixTask);

refresh().catch((error) => {
  $("#summary").textContent = error.message;
});
