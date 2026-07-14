import { ToolRegistry } from "../src/query/tool-system.mjs";
import { registerShellTools, parseSimpleCommand, checkReadOnlyCommand } from "../src/query/shell-command-tool.mjs";

const registry = new ToolRegistry();
registry.register({
  name: "demo.echo",
  description: "Return a demo object.",
  inputSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
    additionalProperties: false
  },
  execute: (input) => ({ value: input.value })
});
registerShellTools(registry);

const demo = await registry.call("demo.echo", { value: "ok" });
assert(demo.result.value === "ok", "registered tool should execute");
assert(registry.getToolDefinitions().some((tool) => tool.name === "shell.read"), "shell.read should be exported to model");

const safe = await registry.call("shell.read", { command: "node --version", timeoutMs: 5000 });
assert(safe.result.ok, "node --version should be allowed");

const gitStatus = checkReadOnlyCommand(parseSimpleCommand("git status --short"));
assert(gitStatus.behavior === "allow", "git status should be read-only");

const gitPush = checkReadOnlyCommand(parseSimpleCommand("git push"));
assert(gitPush.behavior === "deny", "git push should be denied");

await assertRejects(
  () => registry.call("shell.read", { command: "ls && git push" }),
  "compound shell command should be rejected"
);
await assertRejects(
  () => registry.call("shell.read", { command: "rm -rf dist" }),
  "destructive command should be rejected"
);

console.log(JSON.stringify({
  ok: true,
  tools: registry.getToolDefinitions().map((tool) => tool.name),
  nodeVersion: safe.result.stdout.trim()
}, null, 2));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertRejects(fn, message) {
  let rejected = false;
  try {
    await fn();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}
