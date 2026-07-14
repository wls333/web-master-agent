import { createTokenBudget, estimateMessagesTokens, getBudgetStatus } from "./token-budget.mjs";
import { MemoryStore } from "./memory-store.mjs";
import { SystemPromptBuilder, renderSystemPrompt } from "./system-prompt-builder.mjs";

export class ContextEngine {
  constructor({
    memoryStore = new MemoryStore(),
    promptBuilder = new SystemPromptBuilder({ memoryStore }),
    budget = createTokenBudget()
  } = {}) {
    this.memoryStore = memoryStore;
    this.promptBuilder = promptBuilder;
    this.budget = budget;
    this.alreadySurfacedMemories = new Set();
  }

  async build({ messages, tools, sessionId }) {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
    const relevant = await this.memoryStore.findRelevant(latestUserMessage, {
      alreadySurfaced: [...this.alreadySurfacedMemories]
    });
    for (const memory of relevant) this.alreadySurfacedMemories.add(memory.file);
    const loadedMemories = await this.memoryStore.loadMemories(relevant);
    const promptBlocks = await this.promptBuilder.build({
      tools,
      latestUserMessage,
      budget: this.budget,
      memories: loadedMemories
    });

    const microcompacted = microcompactToolResults(messages);
    const compacted = compactByBudget(microcompacted, this.budget);
    const tokenCount = estimateMessagesTokens(compacted) + estimateMessagesTokens([
      { role: "system", content: renderSystemPrompt(promptBlocks) }
    ]);

    return {
      sessionId,
      messages: compacted,
      systemPromptBlocks: promptBlocks,
      systemPrompt: renderSystemPrompt(promptBlocks),
      contextStats: {
        estimatedInputTokens: tokenCount,
        budget: this.budget,
        status: getBudgetStatus(tokenCount, this.budget),
        memoryFiles: loadedMemories.map((memory) => memory.file)
      }
    };
  }
}

export function microcompactToolResults(messages, maxAgeToKeep = 10) {
  let toolSeen = 0;
  return [...messages].reverse().map((message) => {
    if (message.role !== "tool") return message;
    toolSeen += 1;
    if (toolSeen <= maxAgeToKeep) return compactKnownToolResult(message);
    return {
      ...message,
      content: "[Old tool result content cleared by microcompact]"
    };
  }).reverse();
}

function compactKnownToolResult(message) {
  try {
    const parsed = JSON.parse(message.content);
    if (parsed.findings) {
      return {
        ...message,
        content: JSON.stringify({
          id: parsed.id,
          summary: parsed.summary,
          score: parsed.score,
          findings: parsed.findings.slice(0, 8).map((item) => ({
            analyzer: item.analyzer,
            status: item.status,
            message: item.message
          }))
        })
      };
    }
  } catch {
    return message;
  }
  return message;
}

function compactByBudget(messages, budget) {
  let tokenCount = estimateMessagesTokens(messages);
  if (tokenCount < budget.autoCompactAtTokens) return messages;

  const head = messages.slice(0, 4);
  let tail = messages.slice(4);
  while (tail.length > 12 && tokenCount > budget.warningAtTokens) {
    tail = tail.slice(1);
    tokenCount = estimateMessagesTokens([...head, ...tail]);
  }
  return [
    ...head,
    {
      role: "system",
      content: `[compact_boundary auto estimatedTokensBefore=${estimateMessagesTokens(messages)} preservedTailMessages=${tail.length}]`,
      createdAt: new Date().toISOString()
    },
    ...tail
  ];
}
