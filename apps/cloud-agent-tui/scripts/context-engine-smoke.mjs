import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ContextEngine } from "../src/query/context/context-engine.mjs";
import { MemoryStore } from "../src/query/context/memory-store.mjs";
import { createTokenBudget } from "../src/query/context/token-budget.mjs";

const root = ".lightops/context-engine-smoke";
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await writeFile(path.join(root, "MEMORY.md"), [
  "# LightOps Memory Index",
  "",
  "- [Rollback Policy](project_rollback_policy.md) - rollback must be planned before execute"
].join("\n"), "utf8");
await writeFile(path.join(root, "project_rollback_policy.md"), [
  "---",
  "name: Rollback Policy",
  "description: rollback production execute plan policy",
  "type: project",
  "---",
  "",
  "Rollback execute must be separated from rollback plan."
].join("\n"), "utf8");

const memoryStore = new MemoryStore({ rootDir: root });
const engine = new ContextEngine({
  memoryStore,
  budget: createTokenBudget({ contextWindowTokens: 12000, maxOutputTokens: 2000 })
});

const context = await engine.build({
  sessionId: "test",
  tools: [{ name: "cloud.rollback.latest", description: "Rollback latest deployment", inputSchema: { type: "object", properties: {} } }],
  messages: [{ role: "user", content: "请帮我分析 rollback 生产策略" }]
});

assert(context.systemPrompt.includes("Production safety rules"), "system prompt should include static safety rules");
assert(context.systemPrompt.includes("Rollback Policy"), "system prompt should include relevant memory");
assert(context.contextStats.memoryFiles.includes("project_rollback_policy.md"), "memory file should be recalled");
assert(context.contextStats.estimatedInputTokens > 0, "tokens should be estimated");

console.log(JSON.stringify({
  ok: true,
  status: context.contextStats.status,
  estimatedInputTokens: context.contextStats.estimatedInputTokens,
  memoryFiles: context.contextStats.memoryFiles,
  blockCount: context.systemPromptBlocks.length
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
