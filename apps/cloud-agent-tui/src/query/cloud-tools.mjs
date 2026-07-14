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
    this.schemas = new Map([
      ["cloud.state", {
        description: "Read the current Cloud Agent state, including latest scan, incidents, deployments, local fix tasks, and audit summary.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }],
      ["cloud.scan", {
        description: "Run a production readiness and diagnostics scan on the cloud host and configured service.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }],
      ["cloud.incident.create", {
        description: "Create an incident from a production alert, user symptom, business bug, or abnormal runtime signal.",
        inputSchema: {
          type: "object",
          properties: {
            symptom: { type: "string", description: "Short user-facing symptom or alert title." },
            description: { type: "string", description: "Detailed evidence, logs, suspected impact, and reproduction notes." }
          },
          required: ["symptom"],
          additionalProperties: false
        }
      }],
      ["cloud.localFixTask.create", {
        description: "Create a local developer fix task for Codex or Claude Code from the latest or specified incident.",
        inputSchema: {
          type: "object",
          properties: {
            incidentId: { type: "string", description: "Incident id. Omit to use the latest incident." },
            objective: { type: "string", description: "Precise local debugging and code-fix objective." }
          },
          additionalProperties: false
        }
      }],
      ["cloud.deployments.list", {
        description: "List deployment records known by the Cloud Agent.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }],
      ["cloud.rollback.latest", {
        description: "Create a controlled rollback record for the latest deployment.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false
        }
      }]
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

  getToolDefinitions() {
    return [...this.schemas.entries()].map(([name, schema]) => ({
      name,
      description: schema.description,
      inputSchema: schema.inputSchema
    }));
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
