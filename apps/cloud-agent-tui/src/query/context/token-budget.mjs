export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8000;
export const DEFAULT_AUTOCOMPACT_BUFFER_TOKENS = 13000;
export const DEFAULT_WARNING_BUFFER_TOKENS = 20000;

export function estimateTextTokens(text = "", bytesPerToken = 4) {
  return Math.max(1, Math.ceil(String(text).length / bytesPerToken));
}

export function estimateMessageTokens(message) {
  if (!message) return 0;
  const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content || "");
  const roleCost = estimateTextTokens(message.role || "unknown");
  const toolCost = message.toolName ? estimateTextTokens(message.toolName) : 0;
  return roleCost + toolCost + estimateTextTokens(content, looksLikeJson(content) ? 2 : 4);
}

export function estimateMessagesTokens(messages = []) {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

export function createTokenBudget({
  contextWindowTokens = Number(process.env.LIGHTOPS_CONTEXT_WINDOW_TOKENS || DEFAULT_CONTEXT_WINDOW_TOKENS),
  maxOutputTokens = Number(process.env.LIGHTOPS_MAX_OUTPUT_TOKENS || DEFAULT_MAX_OUTPUT_TOKENS),
  autoCompactBufferTokens = DEFAULT_AUTOCOMPACT_BUFFER_TOKENS,
  warningBufferTokens = DEFAULT_WARNING_BUFFER_TOKENS
} = {}) {
  const effectiveInputTokens = Math.max(1000, contextWindowTokens - Math.min(maxOutputTokens, 20000));
  return {
    contextWindowTokens,
    maxOutputTokens,
    effectiveInputTokens,
    warningAtTokens: Math.max(1000, effectiveInputTokens - warningBufferTokens),
    autoCompactAtTokens: Math.max(1000, effectiveInputTokens - autoCompactBufferTokens),
    blockingAtTokens: Math.max(1000, effectiveInputTokens - 3000)
  };
}

export function getBudgetStatus(tokenCount, budget = createTokenBudget()) {
  if (tokenCount >= budget.blockingAtTokens) return "blocking";
  if (tokenCount >= budget.autoCompactAtTokens) return "compact";
  if (tokenCount >= budget.warningAtTokens) return "warning";
  return "ok";
}

function looksLikeJson(text) {
  const trimmed = text.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}
