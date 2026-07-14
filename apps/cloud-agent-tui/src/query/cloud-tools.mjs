import { ToolRegistry } from "./tool-system.mjs";

export class CloudToolRegistry extends ToolRegistry {
  constructor({ apiBase, permissionPolicy } = {}) {
    super({ permissionPolicy });
    this.apiBase = apiBase;
    registerCloudTools(this);
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

function registerCloudTools(registry) {
  registry
    .register({
      name: "cloud.state",
      kind: "cloud-read",
      risk: "read",
      concurrency: "safe",
      description: "Read the current Cloud Agent state, including latest scan, incidents, deployments, local fix tasks, and audit summary.",
      inputSchema: objectSchema({}),
      execute: () => registry.request("GET", "/api/state")
    })
    .register({
      name: "cloud.scan",
      kind: "cloud-diagnostic",
      risk: "read",
      concurrency: "safe",
      maxOutputChars: 8000,
      description: "Run a production readiness and diagnostics scan on the cloud host and configured service.",
      inputSchema: objectSchema({}),
      execute: () => registry.request("POST", "/api/scans", {})
    })
    .register({
      name: "cloud.incident.create",
      kind: "cloud-write",
      risk: "write",
      concurrency: "serial",
      description: "Create an incident from a production alert, user symptom, business bug, or abnormal runtime signal.",
      inputSchema: objectSchema({
        symptom: { type: "string", description: "Short user-facing symptom or alert title." },
        description: { type: "string", description: "Detailed evidence, logs, suspected impact, and reproduction notes." }
      }, ["symptom"]),
      execute: (input) => registry.request("POST", "/api/incidents", {
        symptom: input.symptom || "business abnormality",
        description: input.description || ""
      })
    })
    .register({
      name: "cloud.localFixTask.create",
      kind: "cloud-write",
      risk: "write",
      concurrency: "serial",
      description: "Create a local developer fix task for Codex or Claude Code from the latest or specified incident.",
      inputSchema: objectSchema({
        incidentId: { type: "string", description: "Incident id. Omit to use the latest incident." },
        objective: { type: "string", description: "Precise local debugging and code-fix objective." }
      }),
      execute: async (input) => {
        let incidentId = input.incidentId;
        if (!incidentId) {
          const incidents = await registry.request("GET", "/api/incidents");
          incidentId = incidents[0]?.id;
        }
        if (!incidentId) throw new Error("No incident available for LocalFixTask");
        return registry.request("POST", `/api/incidents/${incidentId}/local-fix-task`, {
          objective: input.objective || "Analyze production evidence and prepare a local code fix task."
        });
      }
    })
    .register({
      name: "cloud.deployments.list",
      kind: "cloud-read",
      risk: "read",
      concurrency: "safe",
      description: "List deployment records known by the Cloud Agent.",
      inputSchema: objectSchema({}),
      execute: () => registry.request("GET", "/api/deployments")
    })
    .register({
      name: "cloud.rollback.latest",
      kind: "cloud-control",
      risk: "dangerous",
      concurrency: "serial",
      permission: { mode: "allow", reason: "prototype controlled rollback endpoint is still explicit API-side policy checked" },
      description: "Create a controlled rollback record for the latest deployment.",
      inputSchema: objectSchema({}),
      execute: async () => {
        const deployments = await registry.request("GET", "/api/deployments");
        const latest = deployments[0];
        if (!latest) throw new Error("No deployment available for rollback");
        return registry.request("POST", `/api/deployments/${latest.id}/rollback`, {});
      }
    });
}

function objectSchema(properties, required = []) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false
  };
}
