import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "../security/redaction.mjs";

export async function collectLogProbe(logPaths = [], workspaceRoot) {
  const logs = [];
  for (const logPath of logPaths) {
    const absolute = path.isAbsolute(logPath) ? logPath : path.resolve(workspaceRoot, logPath);
    try {
      await access(absolute);
      const content = await readFile(absolute, "utf8");
      logs.push({
        path: logPath,
        exists: true,
        tail: redact(content.split(/\r?\n/).slice(-120).join("\n"))
      });
    } catch {
      logs.push({ path: logPath, exists: false, tail: "" });
    }
  }
  return { logs };
}
