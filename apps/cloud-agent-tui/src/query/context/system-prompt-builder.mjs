export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__LIGHTOPS_SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";

export class SystemPromptBuilder {
  constructor({ memoryStore, cwd = process.cwd(), now = () => new Date() } = {}) {
    this.memoryStore = memoryStore;
    this.cwd = cwd;
    this.now = now;
    this.staticBlocks = [
      {
        id: "identity",
        cacheScope: "global",
        content: [
          "You are LightOps Cloud Agent TUI.",
          "You help solo developers and small teams operate production services safely.",
          "You coordinate cloud diagnostics, incident evidence, local fix tasks, deployment checks, and rollback planning."
        ].join("\n")
      },
      {
        id: "safety",
        cacheScope: "global",
        content: [
          "Production safety rules:",
          "- Never claim production state changed unless a tool result proves it.",
          "- Prefer dedicated Cloud tools over shell commands.",
          "- Treat deployment, rollback, restart, deletion, and publishing as dangerous actions.",
          "- Keep secrets out of model-visible output.",
          "- If evidence is incomplete, say what is missing and collect it with tools."
        ].join("\n")
      },
      {
        id: "style",
        cacheScope: "global",
        content: [
          "Answer in concise Chinese by default.",
          "When diagnosing incidents, structure your reasoning around symptom, impact, evidence, hypothesis, and next safest action.",
          "When a local code fix is needed, create a LocalFixTask instead of editing production code on the cloud host."
        ].join("\n")
      }
    ];
  }

  async build({ tools = [], latestUserMessage = "", budget, memories = [] } = {}) {
    const blocks = [...this.staticBlocks, { id: "boundary", boundary: true, content: SYSTEM_PROMPT_DYNAMIC_BOUNDARY }];
    blocks.push({
      id: "runtime",
      cacheScope: null,
      content: [
        `CWD: ${this.cwd}`,
        `Date: ${this.now().toISOString().slice(0, 10)}`,
        budget ? `Context budget: ${budget.contextWindowTokens} tokens, auto compact near ${budget.autoCompactAtTokens}.` : null
      ].filter(Boolean).join("\n")
    });
    blocks.push({
      id: "tools",
      cacheScope: null,
      content: renderTools(tools)
    });

    if (this.memoryStore) {
      const entrypoint = await this.memoryStore.loadEntrypoint();
      blocks.push({
        id: "memory-index",
        cacheScope: null,
        content: [
          "Project memory index:",
          entrypoint,
          "Before relying on memory that names a file, function, command, or flag, verify it with tools."
        ].join("\n")
      });
    }

    if (memories.length) {
      blocks.push({
        id: "relevant-memory",
        cacheScope: null,
        content: [
          `Relevant memory for: ${latestUserMessage}`,
          ...memories.map((memory) => `\n[${memory.type}] ${memory.name || memory.file}\n${memory.content}`)
        ].join("\n")
      });
    }

    return blocks;
  }
}

export function renderSystemPrompt(blocks = []) {
  return blocks
    .filter((block) => !block.boundary)
    .map((block) => block.content)
    .filter(Boolean)
    .join("\n\n");
}

function renderTools(tools) {
  if (!tools.length) return "No tools are currently registered.";
  const lines = ["Registered tools:"];
  for (const tool of tools) {
    lines.push(`- ${tool.name}: ${tool.description}`);
  }
  return lines.join("\n");
}
