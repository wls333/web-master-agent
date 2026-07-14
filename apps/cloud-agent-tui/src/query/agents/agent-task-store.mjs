import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export class AgentTaskStore {
  constructor({ rootDir = ".lightops/agent-tasks", cwd = process.cwd() } = {}) {
    this.rootDir = path.resolve(cwd, rootDir);
  }

  async createTask({ agentName, description, prompt, mode = "sync", isolation = "none" }) {
    await mkdir(this.rootDir, { recursive: true });
    const id = `agent_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
    const task = {
      id,
      agentName,
      description,
      prompt,
      mode,
      isolation,
      status: "queued",
      progress: [],
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await this.save(task);
    return task;
  }

  async listTasks() {
    await mkdir(this.rootDir, { recursive: true });
    const files = (await readdir(this.rootDir)).filter((file) => file.endsWith(".json")).sort().reverse();
    const tasks = [];
    for (const file of files) {
      tasks.push(await this.readByFile(file));
    }
    return tasks;
  }

  async getTask(id) {
    return this.readByFile(`${id}.json`);
  }

  async appendProgress(id, message) {
    const task = await this.getTask(id);
    task.progress.push({
      at: new Date().toISOString(),
      message
    });
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  async complete(id, result) {
    const task = await this.getTask(id);
    task.status = "completed";
    task.result = result;
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  async fail(id, error) {
    const task = await this.getTask(id);
    task.status = "failed";
    task.error = error?.message || String(error);
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  async markRunning(id) {
    const task = await this.getTask(id);
    task.status = "running";
    task.updatedAt = new Date().toISOString();
    await this.save(task);
    return task;
  }

  async save(task) {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.pathFor(task.id), JSON.stringify(task, null, 2), "utf8");
    return task;
  }

  pathFor(id) {
    return path.join(this.rootDir, `${id}.json`);
  }

  async readByFile(file) {
    const text = await readFile(path.join(this.rootDir, file), "utf8");
    return JSON.parse(text);
  }
}
