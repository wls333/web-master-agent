import { createDeepSeekModel } from "../src/query/deepseek-model.mjs";
import { Readable } from "node:stream";

const encoder = new TextEncoder();
const frames = [
  { choices: [{ delta: { content: "正在检查" } }] },
  {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: "call_1",
          function: { name: "cloud__scan", arguments: "{" }
        }]
      }
    }]
  },
  {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          function: { arguments: "}" }
        }]
      },
      finish_reason: "tool_calls"
    }]
  }
];

const fakeFetch = async (_url, request) => {
  const body = JSON.parse(request.body);
  assert(body.tools[0].function.name === "cloud__scan", "tool name should be encoded for OpenAI-compatible APIs");
  return {
    ok: true,
    body: Readable.toWeb(Readable.from(frames.map((frame) => encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)).concat([
      encoder.encode("data: [DONE]\n\n")
    ])))
  };
};

const model = createDeepSeekModel({ apiKey: "test-key", fetchImpl: fakeFetch });
const events = [];
for await (const event of model({
  messages: [{ role: "user", content: "帮我体检" }],
  tools: [{
    name: "cloud.scan",
    description: "scan",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  }]
})) {
  events.push(event);
}

assert(events[0].type === "assistant_text", "first event should be text");
assert(events[1].type === "tool_use", "second event should be tool use");
assert(events[1].name === "cloud.scan", "tool name should be decoded");

console.log(JSON.stringify({ ok: true, events }, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
