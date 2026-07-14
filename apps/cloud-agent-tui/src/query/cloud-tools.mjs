export class CloudToolRegistry {
  constructor({ apiBase }) {
    this.apiBase = apiBase;
    this.tools = new Map([
      ["cloud.state", this.state.bind(this)],
      ["cloud.scan", this.scan.bind(this)],
      ["cloud.incident.create", this.createIncident.bind(this)],
      ["cloud.localFixTask.create", this.createLocalFixTask.bind(this)],
      ["cloud.deployments.list", this.listDeployments.bind(this)],
      ["cloud.rollback.latest", this.rollbackLatest.bind(this)]
    ]);
  }

  has(name) {
    return this.tools.has(name);
  }

  async call(name, input = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    const startedAt = Date.now();
    const result = await tool(input);
    return {
      toolName: name,
      input,
      result,
      durationMs: Date.now() - startedAt
    };
  }

  async state() {
    return this.request("GET", "/api/state");
  }

  async scan() {
    return this.request("POST", "/api/scans", {});
  }

  async createIncident(input) {
    return this.request("POST", "/api/incidents", {
      symptom: input.symptom || "业务异常",
      description: input.description || ""
    });
  }

  async createLocalFixTask(input) {
    let incidentId = input.incidentId;
    if (!incidentId) {
      const incidents = await this.request("GET", "/api/incidents");
      incidentId = incidents[0]?.id;
    }
    if (!incidentId) throw new Error("No incident available for LocalFixTask");
    return this.request("POST", `/api/incidents/${incidentId}/local-fix-task`, {
      objective: input.objective || "根据线上证据定位问题并生成修复建议"
    });
  }

  async listDeployments() {
    return this.request("GET", "/api/deployments");
  }

  async rollbackLatest() {
    const deployments = await this.request("GET", "/api/deployments");
    const latest = deployments[0];
    if (!latest) throw new Error("No deployment available for rollback");
    return this.request("POST", `/api/deployments/${latest.id}/rollback`, {});
  }

  async request(method, path, body) {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message || payload?.error?.code || `${method} ${path} failed`);
    }
    return payload;
  }
}
