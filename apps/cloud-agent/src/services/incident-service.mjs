import { id, nowIso } from "../util/ids.mjs";
import { decidePolicy } from "../security/policy.mjs";

export class IncidentService {
  constructor({ config, store, scanService }) {
    this.config = config;
    this.store = store;
    this.scanService = scanService;
  }

  async createIncident(input = {}) {
    const policy = decidePolicy("incident.create");
    const state = this.store.getState();
    const latestScan = state.scans?.[0] || await this.scanService.runScan();
    const incident = {
      id: id("inc"),
      projectId: this.config.project?.id || "unconfigured",
      severity: input.severity || inferSeverity(input.symptom),
      symptom: input.symptom || "manual_bug_report",
      description: input.description || "",
      status: "open",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      evidence: {
        scanId: latestScan.id,
        findings: (latestScan.findings || []).filter((finding) => finding.status !== "ok").slice(0, 8)
      },
      timeline: [
        { at: nowIso(), type: "incident.created", message: "Incident created from Cloud Agent" }
      ],
      nextActions: [
        "Review evidence in Cloud Agent Web UI",
        "Send LocalFixTask to Local Bridge when connected",
        "Run CI and deployment gates before production release"
      ]
    };
    await this.store.saveIncident(incident);
    await this.store.appendAudit({
      action: "incident.create",
      riskLevel: policy.riskLevel,
      decision: policy.decision,
      status: "success",
      target: { type: "incident", id: incident.id },
      summary: "Incident created"
    });
    return incident;
  }

  async updateIncident(idValue, patch = {}) {
    const incident = this.store.getIncident(idValue);
    if (!incident) return { ok: false, error: { code: "not_found", message: "Incident not found" } };
    const allowedStatuses = new Set(["open", "triaging", "waiting_local_fix", "patch_proposed", "deploying_fix", "observing", "resolved", "closed", "escalated"]);
    const nextStatus = patch.status || incident.status;
    if (!allowedStatuses.has(nextStatus)) {
      return { ok: false, error: { code: "validation_failed", message: `Invalid incident status: ${nextStatus}` } };
    }
    const updated = {
      ...incident,
      severity: patch.severity || incident.severity,
      status: nextStatus,
      resolution: patch.resolution ?? incident.resolution,
      updatedAt: nowIso(),
      timeline: [
        ...(incident.timeline || []),
        { at: nowIso(), type: "incident.updated", message: `Incident updated to ${nextStatus}` }
      ]
    };
    await this.store.saveIncident(updated);
    await this.store.appendAudit({
      action: "incident.update",
      riskLevel: "L0_READONLY",
      decision: "allow",
      status: "success",
      target: { type: "incident", id: updated.id },
      summary: "Incident updated"
    });
    return { ok: true, incident: updated };
  }

  async createLocalFixTask(idValue, input = {}) {
    const incident = this.store.getIncident(idValue);
    if (!incident) return { ok: false, error: { code: "not_found", message: "Incident not found" } };
    const latestScan = this.store.getScan(incident.evidence?.scanId);
    const task = {
      id: id("lfix"),
      incidentId: incident.id,
      projectId: incident.projectId,
      status: "pending_local_bridge",
      createdAt: nowIso(),
      objective: input.objective || `根据线上证据定位并修复：${incident.symptom}`,
      repo: input.repo || null,
      evidenceSummary: {
        symptom: incident.symptom,
        severity: incident.severity,
        description: incident.description,
        findings: incident.evidence?.findings || [],
        healthcheck: latestScan?.httpProbe || null,
        deployment: this.store.listDeployments()[0] || null
      },
      constraints: {
        noProdAccess: true,
        noSecretUpload: true,
        runTests: true,
        createPr: "draft_only",
        ...(input.constraints || {})
      },
      expectedOutputs: ["root_cause", "diff", "tests", "risk_notes", "pr_body"]
    };
    await this.store.saveLocalFixTask(task);
    const updated = {
      ...incident,
      status: "waiting_local_fix",
      updatedAt: nowIso(),
      localFixTask: { id: task.id, status: task.status },
      timeline: [
        ...(incident.timeline || []),
        { at: nowIso(), type: "local_fix_task.created", message: `LocalFixTask ${task.id} created` }
      ]
    };
    await this.store.saveIncident(updated);
    await this.store.appendAudit({
      action: "incident.local_fix_task.create",
      riskLevel: "L0_READONLY",
      decision: "allow",
      status: "success",
      target: { type: "local_fix_task", id: task.id },
      summary: "LocalFixTask created"
    });
    return { ok: true, task, incident: updated };
  }
}

function inferSeverity(symptom = "") {
  if (/payment|pay|login|500|down|crash|unavailable|支付|登录|下单/i.test(symptom)) return "P1";
  return "P2";
}
