import { id, nowIso } from "../util/ids.mjs";

export function analyze(scanInput, project) {
  return [
    ...hostResourceAnalyzer(scanInput.host),
    ...runtimeAnalyzer(scanInput.commands),
    ...projectAnalyzer(scanInput.logs, project),
    ...httpProbeAnalyzer(scanInput.httpProbe),
    ...securityBaselineAnalyzer(scanInput.commands)
  ];
}

function hostResourceAnalyzer(host) {
  const findings = [];
  if (host.memoryUsedRatio !== null && host.memoryUsedRatio > 0.9) {
    findings.push(finding("host_resource_analyzer", "critical", "Host memory usage is above 90%", 0.88, ["Inspect memory-heavy processes", "Consider rollback or restart after approval"]));
  } else {
    findings.push(finding("host_resource_analyzer", "ok", "Host memory usage is within baseline", 0.75, []));
  }
  if (host.cpuCount && host.load1m > host.cpuCount * 2) {
    findings.push(finding("host_resource_analyzer", "warning", "1-minute load is high for available CPU cores", 0.78, ["Inspect traffic and hot processes"]));
  }
  return findings;
}

function runtimeAnalyzer(commands) {
  const findings = [];
  if (!commands.docker?.ok && !commands.podman?.ok) {
    findings.push(finding("runtime_analyzer", "warning", "No Docker or Podman runtime detected", 0.83, ["Install Docker/Podman or choose agent-process runtime"]));
  } else {
    findings.push(finding("runtime_analyzer", "ok", "Container runtime detected", 0.9, []));
  }
  if (!commands.java?.ok) {
    findings.push(finding("java_runtime_analyzer", "info", "Java runtime was not detected on PATH", 0.66, ["If this is a Java service, use container runtime or configure JAVA_HOME"]));
  }
  return findings;
}

function projectAnalyzer(logProbe, project) {
  const findings = [];
  if (!project?.healthcheckUrl) {
    findings.push(finding("project_analyzer", "warning", "No healthcheck URL configured", 0.9, ["Configure /healthz or /actuator/health"]));
  }
  for (const log of logProbe.logs || []) {
    if (!log.exists) {
      findings.push(finding("log_signature_analyzer", "warning", `Configured log path does not exist: ${log.path}`, 0.8, ["Update logPaths in configuration"]));
      continue;
    }
    const errorLines = log.tail.split(/\r?\n/).filter((line) => /exception|error|failed|timeout|refused|oom|outofmemory/i.test(line));
    if (errorLines.length) {
      findings.push(finding("log_signature_analyzer", "warning", `Recent logs contain ${errorLines.length} suspicious lines`, 0.82, ["Create incident and send evidence to Local Bridge"]));
    }
  }
  return findings;
}

function httpProbeAnalyzer(probe) {
  if (!probe.configured) {
    return [finding("http_probe_analyzer", "warning", "HTTP health probe is not configured", 0.9, ["Add a healthcheck URL"])];
  }
  if (!probe.ok) {
    return [finding("http_probe_analyzer", "critical", `Health probe failed: ${probe.status || probe.error}`, 0.92, ["Check service process, port, reverse proxy and recent deployment"])];
  }
  return [finding("http_probe_analyzer", "ok", `Health probe passed in ${probe.latencyMs}ms`, 0.92, [])];
}

function securityBaselineAnalyzer(commands) {
  if (!commands.nginx?.ok) {
    return [finding("security_baseline_analyzer", "info", "Nginx not detected; domain/TLS automation may need Caddy or direct port mode", 0.6, [])];
  }
  return [finding("security_baseline_analyzer", "ok", "Reverse proxy runtime detected", 0.7, [])];
}

function finding(analyzer, status, message, confidence, suggestedActions) {
  return {
    id: id("fnd"),
    analyzer,
    status,
    message,
    confidence,
    suggestedActions,
    riskLevel: "L1_DIAGNOSTIC",
    createdAt: nowIso()
  };
}

export function calculateScore(findings) {
  let score = 100;
  for (const item of findings) {
    if (item.status === "critical") score -= 30;
    if (item.status === "warning") score -= 12;
    if (item.status === "info") score -= 3;
  }
  return Math.max(0, score);
}

export function summarizeFindings(findings) {
  const counts = findings.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  if (counts.critical) return `${counts.critical} critical issue(s) need attention`;
  if (counts.warning) return `${counts.warning} warning(s) found`;
  return "No blocking issue detected";
}
