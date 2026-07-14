import { readFile, writeFile, mkdir, appendFile, rename } from "node:fs/promises";
import path from "node:path";
import { id, nowIso } from "../util/ids.mjs";
import { redactObject } from "../security/redaction.mjs";

export class FileStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.statePath = path.join(dataDir, "state", "state.json");
    this.auditPath = path.join(dataDir, "audit", "audit.jsonl");
    this.state = null;
  }

  async init() {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    await mkdir(path.dirname(this.auditPath), { recursive: true });
    this.state = await this.loadState();
    return this;
  }

  async loadState() {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8"));
    } catch {
      return {
        version: 1,
        bootedAt: nowIso(),
        scans: [],
        incidents: [],
        deployments: [],
        revisions: [],
        localFixTasks: []
      };
    }
  }

  getState() {
    return this.state;
  }

  async saveState() {
    const tmp = `${this.statePath}.tmp`;
    await writeFile(tmp, JSON.stringify(this.state, null, 2), "utf8");
    await rename(tmp, this.statePath);
  }

  async appendAudit(event) {
    const auditEvent = {
      id: event.id || id("aud"),
      createdAt: nowIso(),
      ...redactObject(event)
    };
    await appendFile(this.auditPath, `${JSON.stringify(auditEvent)}\n`, "utf8");
    this.state.audit = [auditEvent, ...(this.state.audit || [])].slice(0, 100);
    await this.saveState();
    return auditEvent;
  }

  async saveScan(scan) {
    this.state.scans = [scan, ...(this.state.scans || [])].slice(0, 20);
    await this.saveState();
    return scan;
  }

  listScans() {
    return this.state.scans || [];
  }

  getScan(id) {
    return this.listScans().find((item) => item.id === id) || null;
  }

  async saveIncident(incident) {
    this.state.incidents = upsertById(this.state.incidents || [], incident).slice(0, 100);
    await this.saveState();
    return incident;
  }

  listIncidents() {
    return this.state.incidents || [];
  }

  getIncident(id) {
    return this.listIncidents().find((item) => item.id === id) || null;
  }

  async saveDeployment(deployment, keepRevisions = 5) {
    this.state.deployments = upsertById(this.state.deployments || [], deployment).slice(0, 100);
    if (deployment.revision) {
      this.state.revisions = upsertByRevision(this.state.revisions || [], deployment).slice(0, keepRevisions);
    }
    await this.saveState();
    return deployment;
  }

  listDeployments() {
    return this.state.deployments || [];
  }

  getDeployment(id) {
    return this.listDeployments().find((item) => item.id === id) || null;
  }

  getLatestSuccessfulDeployment(service, env = "prod") {
    return this.listDeployments().find((item) =>
      item.service === service &&
      item.env === env &&
      ["succeeded", "rolled_back"].includes(item.state)
    ) || null;
  }

  async saveLocalFixTask(task) {
    this.state.localFixTasks = upsertById(this.state.localFixTasks || [], task).slice(0, 100);
    await this.saveState();
    return task;
  }

  listLocalFixTasks() {
    return this.state.localFixTasks || [];
  }

  getLocalFixTask(id) {
    return this.listLocalFixTasks().find((item) => item.id === id) || null;
  }
}

function upsertById(items, item) {
  return [item, ...items.filter((existing) => existing.id !== item.id)];
}

function upsertByRevision(items, item) {
  return [item, ...items.filter((existing) => existing.revision !== item.revision)];
}
