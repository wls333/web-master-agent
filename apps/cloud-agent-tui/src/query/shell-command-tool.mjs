import { spawn } from "node:child_process";

const READ_COMMANDS = new Set([
  "cat", "head", "tail", "wc", "stat", "file", "jq", "awk", "sort", "uniq",
  "git", "node", "npm"
]);
const SEARCH_COMMANDS = new Set(["find", "grep", "rg", "ag", "ack", "locate", "which", "whereis"]);
const LIST_COMMANDS = new Set(["ls", "tree", "du", "pwd"]);
const NEUTRAL_COMMANDS = new Set(["echo", "printf", "true", "false"]);
const GIT_READ_SUBCOMMANDS = new Set(["status", "log", "show", "diff", "branch", "rev-parse", "remote"]);
const NPM_READ_SUBCOMMANDS = new Set(["--version", "-v", "version", "ls", "list", "outdated"]);
const NODE_READ_SUBCOMMANDS = new Set(["--version", "-v"]);
const UNSAFE_TOKENS = /[|&;<>()`$\\]/;

export function registerShellTools(registry, { cwd = process.cwd() } = {}) {
  registry.register({
    name: "shell.read",
    kind: "shell",
    risk: "read",
    concurrency: "safe",
    maxOutputChars: 12000,
    description: "Run a simple read-only shell command for local diagnostics. Complex shell syntax, writes, network publishing, and destructive commands are rejected.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Simple read-only command, for example: rg TODO apps, git status --short, node --version." },
        timeoutMs: { type: "number", description: "Optional timeout between 1000 and 120000 ms." }
      },
      required: ["command"],
      additionalProperties: false
    },
    execute: (input) => runReadOnlyCommand(input.command, {
      cwd,
      timeoutMs: clampTimeout(input.timeoutMs)
    })
  });
}

export async function runReadOnlyCommand(command, { cwd = process.cwd(), timeoutMs = 120000 } = {}) {
  const parsed = parseSimpleCommand(command);
  const permission = checkReadOnlyCommand(parsed);
  if (permission.behavior !== "allow") throw new Error(permission.reason);

  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(parsed.command, parsed.args, {
      cwd,
      shell: false,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      totalBytes += chunk.length;
      stdout = keepTail(stdout + chunk.toString(), 12000);
    });
    child.stderr.on("data", (chunk) => {
      totalBytes += chunk.length;
      stderr = keepTail(stderr + chunk.toString(), 4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        command,
        error: error.message,
        elapsedMs: Date.now() - startedAt
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        command,
        code,
        timedOut,
        stdout,
        stderr,
        elapsedMs: Date.now() - startedAt,
        totalBytes,
        isIncomplete: totalBytes > stdout.length + stderr.length
      });
    });
  });
}

export function parseSimpleCommand(command) {
  if (!command || typeof command !== "string") throw new Error("command is required");
  if (command.length > 1000) throw new Error("command is too long");
  if (UNSAFE_TOKENS.test(command)) {
    throw new Error("complex shell syntax is not allowed for shell.read");
  }
  const argv = splitArgs(command.trim());
  if (!argv.length) throw new Error("command is empty");
  return {
    command: argv[0],
    args: argv.slice(1),
    argv
  };
}

export function checkReadOnlyCommand(parsed) {
  const base = normalizeBaseCommand(parsed.command);
  if (NEUTRAL_COMMANDS.has(base) || SEARCH_COMMANDS.has(base) || LIST_COMMANDS.has(base)) {
    return { behavior: "allow", reason: "read_only_command" };
  }
  if (!READ_COMMANDS.has(base)) {
    return { behavior: "deny", reason: `command is not in read-only allowlist: ${base}` };
  }
  if (base === "git") return checkSubcommand(parsed.args, GIT_READ_SUBCOMMANDS, "git");
  if (base === "npm") return checkSubcommand(parsed.args, NPM_READ_SUBCOMMANDS, "npm");
  if (base === "node") return checkSubcommand(parsed.args, NODE_READ_SUBCOMMANDS, "node");
  return { behavior: "allow", reason: "read_only_command" };
}

function checkSubcommand(args, allowlist, command) {
  const subcommand = args.find((arg) => !arg.startsWith("-")) || args[0] || "";
  if (allowlist.has(subcommand)) return { behavior: "allow", reason: `${command}_read_only_subcommand` };
  return { behavior: "deny", reason: `${command} subcommand is not read-only: ${subcommand || "(missing)"}` };
}

function splitArgs(command) {
  const args = [];
  let current = "";
  let quote = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("unterminated quote in command");
  if (current) args.push(current);
  return args;
}

function normalizeBaseCommand(command) {
  return command.replace(/\\/g, "/").split("/").pop().toLowerCase();
}

function clampTimeout(value) {
  if (!value) return 120000;
  return Math.max(1000, Math.min(120000, Number(value)));
}

function keepTail(text, maxChars) {
  if (text.length <= maxChars) return text;
  return text.slice(-maxChars);
}
