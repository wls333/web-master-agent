const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

export function createDeepSeekModel({
  apiKey,
  baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
  model = process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
  temperature = Number(process.env.DEEPSEEK_TEMPERATURE || "0.2"),
  fetchImpl = fetch
} = {}) {
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");

  return async function* deepSeekModel({ messages, toolResults = [], tools = [], systemPrompt }) {
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        temperature,
        stream: true,
        messages: toDeepSeekMessages(messages, toolResults, systemPrompt),
        tools: tools.map(toOpenAITool),
        tool_choice: tools.length ? "auto" : undefined
      })
    });

    if (!response.ok) {
      const body = await safeText(response);
      throw new Error(`DeepSeek request failed (${response.status}): ${body.slice(0, 500)}`);
    }
    if (!response.body) throw new Error("DeepSeek response did not include a stream body");

    const toolCalls = new Map();
    for await (const payload of readSseJson(response.body)) {
      const choice = payload.choices?.[0];
      const delta = choice?.delta || {};
      if (delta.content) yield { type: "assistant_text", content: delta.content };
      if (delta.tool_calls) mergeToolCalls(toolCalls, delta.tool_calls);
      if (choice?.finish_reason === "tool_calls") {
        for (const call of finalizeToolCalls(toolCalls)) yield call;
      }
    }
  };
}

function toDeepSeekMessages(messages, toolResults, systemPrompt) {
  const system = {
    role: "system",
    content: systemPrompt || [
      "You are LightOps Cloud Agent TUI.",
      "Your job is to help a solo developer or small team operate production services.",
      "Use tools whenever live cloud state, diagnostics, incident creation, fix-task generation, or rollback evidence is needed.",
      "Answer in concise Chinese. Be careful with production safety. Never claim a deployment or rollback succeeded unless a tool result proves it.",
      "When a user reports an outage, alert, 500 error, business failure, or bug, create or update operational evidence first."
    ].join("\n")
  };

  const normalized = messages.slice(-28).map((message) => {
    if (message.role === "tool") {
      return {
        role: "user",
        content: `Tool result from ${message.toolName || "unknown"}:\n${message.content}`
      };
    }
    if (message.role === "system") return { role: "system", content: message.content };
    if (message.role === "assistant") return { role: "assistant", content: message.content };
    return { role: "user", content: message.content };
  });

  if (toolResults.length) {
    normalized.push({
      role: "user",
      content: `The following tool calls just completed. Summarize the operational result and suggest the next safest step:\n${JSON.stringify(toolResults, null, 2).slice(0, 6000)}`
    });
  }

  return [system, ...normalized];
}

function toOpenAITool(tool) {
  return {
    type: "function",
    function: {
      name: encodeToolName(tool.name),
      description: tool.description,
      parameters: tool.inputSchema
    }
  };
}

function mergeToolCalls(toolCalls, deltas) {
  for (const delta of deltas) {
    const index = delta.index ?? toolCalls.size;
    const current = toolCalls.get(index) || {
      encodedName: "",
      id: delta.id,
      argumentsText: ""
    };
    if (delta.id) current.id = delta.id;
    if (delta.function?.name) current.encodedName += delta.function.name;
    if (delta.function?.arguments) current.argumentsText += delta.function.arguments;
    toolCalls.set(index, current);
  }
}

function finalizeToolCalls(toolCalls) {
  return [...toolCalls.values()].map((call) => ({
    type: "tool_use",
    name: decodeToolName(call.encodedName),
    input: parseToolArguments(call.argumentsText)
  }));
}

function parseToolArguments(text) {
  if (!text?.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function* readSseJson(stream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        yield JSON.parse(data);
      }
    }
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return response.statusText || "unknown error";
  }
}

function encodeToolName(name) {
  return name.replaceAll(".", "__");
}

function decodeToolName(name) {
  return name.replaceAll("__", ".");
}
