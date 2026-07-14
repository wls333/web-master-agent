import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const paths = {
  srcRoot: __dirname,
  appRoot: path.resolve(__dirname, ".."),
  workspaceRoot: path.resolve(__dirname, "..", "..", "..")
};

export async function loadConfig() {
  const defaultConfigPath = path.join(paths.appRoot, "config.example.json");
  const userConfigPath = path.join(paths.workspaceRoot, ".lightops.cloud-agent.json");
  const base = JSON.parse(await readFile(defaultConfigPath, "utf8"));
  let user = {};
  try {
    user = JSON.parse(await readFile(userConfigPath, "utf8"));
  } catch {
    user = {};
  }
  const config = deepMerge(base, user);
  config.dataDirAbs = path.resolve(paths.workspaceRoot, config.dataDir || ".lightops/cloud-agent");
  await mkdir(config.dataDirAbs, { recursive: true });
  return config;
}

export async function saveUserConfig(patch) {
  const userConfigPath = path.join(paths.workspaceRoot, ".lightops.cloud-agent.json");
  let current = {};
  try {
    current = JSON.parse(await readFile(userConfigPath, "utf8"));
  } catch {
    current = {};
  }
  const next = deepMerge(current, patch);
  await writeFile(userConfigPath, JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function mergeConfig(target, patch) {
  const next = deepMerge(target, patch);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
  return target;
}

export function publicConfig(config) {
  return {
    agentName: config.agentName,
    bindHost: config.bindHost,
    port: config.port,
    project: config.project,
    deployment: {
      allowRealDeploy: Boolean(config.deployment?.allowRealDeploy),
      defaultRuntime: config.deployment?.defaultRuntime,
      keepRevisions: config.deployment?.keepRevisions
    },
    controlPlaneConnected: Boolean(config.controlPlaneUrl)
  };
}

function deepMerge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      output[key] = deepMerge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}
