import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ENTRYPOINT = "MEMORY.md";
const MAX_ENTRYPOINT_BYTES = 25000;
const MAX_ENTRYPOINT_LINES = 200;
const MEMORY_TYPES = new Set(["user", "feedback", "project", "reference"]);

export class MemoryStore {
  constructor({ rootDir = ".lightops/memory", cwd = process.cwd() } = {}) {
    this.rootDir = path.resolve(cwd, rootDir);
  }

  async ensure() {
    await mkdir(this.rootDir, { recursive: true });
    const entry = path.join(this.rootDir, ENTRYPOINT);
    try {
      await readFile(entry, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await writeFile(entry, "# LightOps Memory Index\n\n", "utf8");
    }
  }

  async loadEntrypoint() {
    await this.ensure();
    const text = await readFile(path.join(this.rootDir, ENTRYPOINT), "utf8");
    return truncateEntrypoint(text);
  }

  async scanManifest() {
    await this.ensure();
    const files = await readdir(this.rootDir);
    const memories = [];
    for (const file of files) {
      if (!file.endsWith(".md") || file === ENTRYPOINT) continue;
      const absolutePath = path.join(this.rootDir, file);
      const text = await readFile(absolutePath, "utf8");
      const parsed = parseMemoryFile(text);
      if (!parsed || !MEMORY_TYPES.has(parsed.type)) continue;
      memories.push({
        file,
        absolutePath,
        ...parsed
      });
    }
    return memories;
  }

  async findRelevant(query, { limit = 5, alreadySurfaced = [] } = {}) {
    if (/ignore memory|do not use memory|忽略记忆|不要使用记忆/i.test(query || "")) return [];
    const surfaced = new Set(alreadySurfaced);
    const terms = tokenize(query);
    const manifest = await this.scanManifest();
    return manifest
      .filter((memory) => !surfaced.has(memory.file))
      .map((memory) => ({ memory, score: scoreMemory(memory, terms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  async loadMemories(memories, { maxCharsPerMemory = 3000 } = {}) {
    const loaded = [];
    for (const memory of memories) {
      const text = await readFile(memory.absolutePath, "utf8");
      loaded.push({
        ...memory,
        content: text.slice(0, maxCharsPerMemory)
      });
    }
    return loaded;
  }
}

export function parseMemoryFile(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/m.exec(text);
  if (!match) return null;
  const frontmatter = Object.fromEntries(match[1]
    .split(/\r?\n/)
    .map((line) => line.split(/:\s*/))
    .filter((parts) => parts.length >= 2)
    .map(([key, ...rest]) => [key.trim(), rest.join(":").trim()]));
  return {
    name: frontmatter.name,
    description: frontmatter.description || "",
    type: frontmatter.type,
    body: match[2].trim()
  };
}

function truncateEntrypoint(text) {
  const lines = text.split(/\r?\n/).slice(0, MAX_ENTRYPOINT_LINES);
  let result = lines.join("\n");
  if (result.length > MAX_ENTRYPOINT_BYTES) result = result.slice(0, MAX_ENTRYPOINT_BYTES);
  if (result.length < text.length) {
    result += "\n\n[Memory index truncated: use a more specific query if needed.]";
  }
  return result;
}

function scoreMemory(memory, terms) {
  const haystack = `${memory.name || ""} ${memory.description || ""} ${memory.type || ""}`.toLowerCase();
  if (!terms.length) return memory.type === "feedback" ? 1 : 0;
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

function tokenize(text = "") {
  return String(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((term) => term.length >= 2)
    .slice(0, 30);
}
