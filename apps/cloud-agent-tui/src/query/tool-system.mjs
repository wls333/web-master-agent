export class ToolRegistry {
  constructor({ permissionPolicy = defaultPermissionPolicy } = {}) {
    this.permissionPolicy = permissionPolicy;
    this.tools = new Map();
  }

  register(tool) {
    validateToolDefinition(tool);
    this.tools.set(tool.name, {
      kind: "operation",
      risk: "read",
      concurrency: "safe",
      maxOutputChars: 4000,
      permission: { mode: "allow" },
      ...tool
    });
    return this;
  }

  has(name) {
    return this.tools.has(name);
  }

  get(name) {
    return this.tools.get(name);
  }

  getToolDefinitions() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }

  getToolMetadata() {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      kind: tool.kind,
      risk: tool.risk,
      concurrency: tool.concurrency,
      permission: tool.permission
    }));
  }

  async call(name, input = {}, context = {}) {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    validateInputShape(tool, input);
    const permission = await this.permissionPolicy({ tool, input, context });
    if (permission.behavior !== "allow") {
      throw new Error(permission.reason || `Tool permission denied: ${name}`);
    }

    const startedAt = Date.now();
    const result = await tool.execute(input, context);
    return {
      toolName: name,
      input: redactInput(input, tool),
      result: applyOutputBudget(result, tool.maxOutputChars),
      durationMs: Date.now() - startedAt,
      permission,
      metadata: {
        kind: tool.kind,
        risk: tool.risk,
        concurrency: tool.concurrency
      }
    };
  }
}

export async function defaultPermissionPolicy({ tool }) {
  if (tool.permission?.mode === "deny") {
    return { behavior: "deny", reason: tool.permission.reason || "tool is disabled by policy" };
  }
  if (tool.risk === "dangerous" && tool.permission?.mode !== "allow") {
    return { behavior: "deny", reason: "dangerous tool requires explicit allow policy" };
  }
  return { behavior: "allow", reason: "policy_allow" };
}

export function applyOutputBudget(result, maxChars = 4000) {
  const json = JSON.stringify(result);
  if (json.length <= maxChars) return result;
  return {
    isIncomplete: true,
    truncatedAtChars: maxChars,
    preview: json.slice(0, maxChars)
  };
}

function validateToolDefinition(tool) {
  if (!tool?.name || typeof tool.name !== "string") throw new Error("tool.name is required");
  if (!tool.description || typeof tool.description !== "string") throw new Error(`tool.description is required: ${tool.name}`);
  if (!tool.inputSchema || tool.inputSchema.type !== "object") throw new Error(`tool.inputSchema object schema is required: ${tool.name}`);
  if (typeof tool.execute !== "function") throw new Error(`tool.execute is required: ${tool.name}`);
}

function validateInputShape(tool, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`Tool input must be an object: ${tool.name}`);
  }
  const required = tool.inputSchema.required || [];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") {
      throw new Error(`Missing required input "${key}" for ${tool.name}`);
    }
  }
  if (tool.inputSchema.additionalProperties === false) {
    const allowed = new Set(Object.keys(tool.inputSchema.properties || {}));
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) throw new Error(`Unknown input "${key}" for ${tool.name}`);
    }
  }
}

function redactInput(input, tool) {
  const secretFields = new Set(tool.secretFields || []);
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [
    key,
    secretFields.has(key) ? "[redacted]" : value
  ]));
}
