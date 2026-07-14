import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class SessionStore {
  constructor({ rootDir = ".lightops/tui-sessions", cwd = process.cwd() } = {}) {
    this.rootDir = path.resolve(cwd, rootDir);
  }

  async createSession() {
    await mkdir(this.rootDir, { recursive: true });
    const id = randomUUID();
    const filePath = this.pathFor(id);
    await this.append(id, {
      type: "session_start",
      sessionId: id,
      cwd: process.cwd(),
      createdAt: new Date().toISOString()
    });
    return { id, filePath };
  }

  async latestSessionId() {
    await mkdir(this.rootDir, { recursive: true });
    const files = (await readdir(this.rootDir))
      .filter((file) => file.endsWith(".jsonl"))
      .sort();
    return files.at(-1)?.replace(/\.jsonl$/, "") || null;
  }

  async load(sessionId) {
    const filePath = this.pathFor(sessionId);
    const raw = await readFile(filePath, "utf8");
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async append(sessionId, entry) {
    await mkdir(this.rootDir, { recursive: true });
    const record = {
      timestamp: new Date().toISOString(),
      ...entry
    };
    await appendFile(this.pathFor(sessionId), `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  pathFor(sessionId) {
    return path.join(this.rootDir, `${sessionId}.jsonl`);
  }
}
