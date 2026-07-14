import { localRuleModel } from "./local-rule-model.mjs";
import { printBlock, typewriter } from "./typewriter.mjs";

export class QueryEngine {
  constructor({ sessionStore, toolRegistry, sessionId, maxTurns = 6 }) {
    this.sessionStore = sessionStore;
    this.toolRegistry = toolRegistry;
    this.sessionId = sessionId;
    this.maxTurns = maxTurns;
    this.messages = [];
    this.turnCount = 0;
    this.totalUsage = { inputChars: 0, outputChars: 0, toolCalls: 0 };
  }

  async restore() {
    if (!this.sessionId) {
      const session = await this.sessionStore.createSession();
      this.sessionId = session.id;
      return this;
    }
    const records = await this.sessionStore.load(this.sessionId);
    for (const record of records) {
      if (record.type === "message") this.messages.push(record.message);
    }
    return this;
  }

  async submitMessage(content) {
    const userMessage = { role: "user", content, createdAt: new Date().toISOString() };
    this.messages.push(userMessage);
    await this.persistMessage(userMessage);

    let state = {
      messages: this.messages,
      turnCount: 0,
      transition: undefined,
      maxOutputTokensRecoveryCount: 0,
      hasAttemptedReactiveCompact: false
    };

    while (true) {
      if (state.turnCount >= this.maxTurns) {
        await printBlock("已达到本轮最大循环次数，已停止继续调用工具。");
        await this.sessionStore.append(this.sessionId, { type: "termination", reason: "max_turns" });
        return { reason: "max_turns" };
      }

      const preprocessed = this.preprocess(state.messages);
      const toolResults = [];
      let needsFollowUp = false;
      let assistantText = "";

      await this.sessionStore.append(this.sessionId, {
        type: "turn_start",
        turn: state.turnCount + 1,
        transition: state.transition
      });

      for await (const event of localRuleModel({ messages: preprocessed, toolResults: state.toolResults || [] })) {
        if (event.type === "assistant_text") {
          assistantText += event.content;
          await typewriter(event.content);
        }
        if (event.type === "tool_use") {
          needsFollowUp = true;
          await this.onToolUse(event, toolResults);
        }
      }

      if (assistantText) {
        process.stdout.write("\n");
        const assistantMessage = { role: "assistant", content: assistantText, createdAt: new Date().toISOString() };
        this.messages.push(assistantMessage);
        await this.persistMessage(assistantMessage);
        this.totalUsage.outputChars += assistantText.length;
      }

      if (!needsFollowUp) {
        await this.sessionStore.append(this.sessionId, {
          type: "termination",
          reason: "completed",
          totalUsage: this.totalUsage
        });
        return { reason: "completed" };
      }

      for (const result of toolResults) {
        const toolMessage = {
          role: "tool",
          toolName: result.toolName,
          content: JSON.stringify(result.result).slice(0, 4000),
          createdAt: new Date().toISOString()
        };
        this.messages.push(toolMessage);
        await this.persistMessage(toolMessage);
      }

      state = {
        ...state,
        messages: this.messages,
        toolResults,
        turnCount: state.turnCount + 1,
        transition: { reason: "next_turn" }
      };
    }
  }

  preprocess(messages) {
    return autoCompact(applyToolResultBudget(microcompact(messages)));
  }

  async onToolUse(event, toolResults) {
    await this.sessionStore.append(this.sessionId, {
      type: "tool_use",
      name: event.name,
      input: event.input
    });
    console.log(`\n[tool] ${event.name}`);
    if (!this.toolRegistry.has(event.name)) {
      throw new Error(`Tool is not registered: ${event.name}`);
    }
    const result = await this.toolRegistry.call(event.name, event.input);
    this.totalUsage.toolCalls += 1;
    toolResults.push(result);
    await this.sessionStore.append(this.sessionId, {
      type: "tool_result",
      name: event.name,
      durationMs: result.durationMs,
      result: result.result
    });
  }

  async persistMessage(message) {
    this.totalUsage.inputChars += message.role === "user" ? message.content.length : 0;
    await this.sessionStore.append(this.sessionId, {
      type: "message",
      message
    });
  }
}

function applyToolResultBudget(messages, maxChars = 4000) {
  return messages.map((message) => {
    if (message.role !== "tool" || message.content.length <= maxChars) return message;
    return {
      ...message,
      content: `${message.content.slice(0, maxChars)}\n[tool result truncated]`
    };
  });
}

function microcompact(messages) {
  return messages.map((message) => {
    if (message.role !== "tool") return message;
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
  });
}

function autoCompact(messages, maxMessages = 30) {
  if (messages.length <= maxMessages) return messages;
  const head = messages.slice(0, 4);
  const tail = messages.slice(-maxMessages + 5);
  return [
    ...head,
    {
      role: "system",
      content: `[history compacted: ${messages.length - head.length - tail.length} messages omitted]`,
      createdAt: new Date().toISOString()
    },
    ...tail
  ];
}
