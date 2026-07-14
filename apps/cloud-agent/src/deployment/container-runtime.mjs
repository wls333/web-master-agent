import { runCommand } from "../util/process.mjs";
import { id, nowIso } from "../util/ids.mjs";

export async function executeContainerDeployment(spec, validation, config) {
  const timeline = [];
  const runtime = await detectContainerRuntime();
  if (!runtime.ok) {
    return failedDeployment(spec, validation, config, timeline, "container_runtime_missing", runtime.message);
  }

  const deploymentId = id("dep");
  const service = spec.service || config.project?.id || "service";
  const env = spec.env || "prod";
  const revision = `${spec.artifact?.tag || "unknown"}-${Date.now()}`;
  const containerName = safeName(`lightops_${service}_${env}_${revision}`);
  const imageRef = imageReference(spec.artifact);

  push(timeline, "validating", "DeploySpec validated");
  push(timeline, "pulling_artifact", `Pulling image ${imageRef}`);
  const pull = await runCommand(runtime.command, ["pull", imageRef], { timeoutMs: 120000, maxOutput: 2000 });
  if (!pull.ok) return failedDeployment(spec, validation, config, timeline, "image_pull_failed", pull.output || pull.error);

  push(timeline, "preparing_revision", "Inspecting image digest");
  const inspect = await runCommand(runtime.command, ["image", "inspect", imageRef], { timeoutMs: 15000, maxOutput: 4000 });
  const digest = extractDigest(inspect.output) || spec.artifact?.digest || null;

  const runArgs = buildRunArgs({
    spec,
    containerName,
    deploymentId,
    service,
    env,
    revision,
    imageRef
  });

  push(timeline, "starting", `Starting container ${containerName}`);
  const run = await runCommand(runtime.command, runArgs, { timeoutMs: 30000, maxOutput: 3000 });
  if (!run.ok) return failedDeployment(spec, validation, config, timeline, "container_start_failed", run.output || run.error);

  push(timeline, "probing", "Running healthcheck");
  const probe = await waitForHealth(spec.healthcheck, 5);
  if (!probe.ok) {
    push(timeline, "failed", `Healthcheck failed: ${probe.message}`);
    return {
      ...baseDeployment(spec, validation, config),
      id: deploymentId,
      state: "failed",
      status: "healthcheck_failed",
      dryRun: false,
      revision,
      containerName,
      imageDigest: digest,
      timeline,
      failure: probe,
      notes: ["New container was started but healthcheck failed. Manual cleanup may be required."]
    };
  }

  push(timeline, "observing", "Initial healthcheck passed");
  push(timeline, "succeeded", "Container deployment succeeded");
  return {
    ...baseDeployment(spec, validation, config),
    id: deploymentId,
    state: "succeeded",
    status: "deployed",
    dryRun: false,
    revision,
    containerName,
    imageDigest: digest,
    timeline,
    notes: ["Container started and initial healthcheck passed."]
  };
}

async function detectContainerRuntime() {
  const docker = await runCommand("docker", ["--version"], { timeoutMs: 3000 });
  if (docker.ok) return { ok: true, command: "docker" };
  const podman = await runCommand("podman", ["--version"], { timeoutMs: 3000 });
  if (podman.ok) return { ok: true, command: "podman" };
  return { ok: false, message: "Docker/Podman runtime not found" };
}

function buildRunArgs({ spec, containerName, deploymentId, service, env, revision, imageRef }) {
  const args = [
    "run",
    "-d",
    "--name", containerName,
    "--label", "lightops.managed=true",
    "--label", `lightops.deploy_id=${deploymentId}`,
    "--label", `lightops.service=${service}`,
    "--label", `lightops.env=${env}`,
    "--label", `lightops.revision=${revision}`
  ];

  for (const port of spec.container?.ports || []) {
    if (port.host_port && port.container_port) {
      args.push("-p", `${port.host_port}:${port.container_port}/${port.protocol || "tcp"}`);
    }
  }
  for (const [key, value] of Object.entries(spec.container?.env || {})) {
    args.push("-e", `${key}=${value}`);
  }
  for (const volume of spec.container?.volumes || []) {
    if (volume.host_path && volume.mount_path) {
      args.push("-v", `${volume.host_path}:${volume.mount_path}`);
    }
  }
  if (spec.container?.resources?.memory_limit) {
    args.push("--memory", String(spec.container.resources.memory_limit));
  }
  if (spec.container?.resources?.cpu_limit) {
    args.push("--cpus", String(spec.container.resources.cpu_limit));
  }
  args.push(imageRef);
  return args;
}

async function waitForHealth(healthcheck, attempts) {
  if (!healthcheck?.url) return { ok: true, message: "No healthcheck URL configured; skipped" };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (healthcheck.timeout_seconds || 3) * 1000);
      const response = await fetch(healthcheck.url, { signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) {
        return { ok: true, status: response.status, latencyMs: Date.now() - started, attempts: attempt };
      }
    } catch (error) {
      if (attempt === attempts) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), attempts: attempt };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, (healthcheck.interval_seconds || 2) * 1000));
  }
  return { ok: false, message: "Healthcheck did not pass", attempts };
}

function failedDeployment(spec, validation, config, timeline, code, message) {
  push(timeline, "failed", message);
  return {
    ...baseDeployment(spec, validation, config),
    state: "failed",
    status: code,
    dryRun: false,
    failure: { code, message },
    timeline,
    notes: ["Deployment failed before traffic promotion."]
  };
}

function baseDeployment(spec, validation, config) {
  return {
    id: id("dep"),
    service: spec.service || config.project?.id || "service",
    env: spec.env || "prod",
    runtime: validation.normalized.runtime,
    artifact: spec.artifact,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    healthcheck: spec.healthcheck,
    rollback: validation.normalized.rollback
  };
}

function imageReference(artifact = {}) {
  if (artifact.digest) return `${artifact.image}@${artifact.digest}`;
  return `${artifact.image}:${artifact.tag}`;
}

function extractDigest(output = "") {
  const match = output.match(/sha256:[a-f0-9]{64}/i);
  return match?.[0] || null;
}

function safeName(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

function push(timeline, state, message) {
  timeline.push({ state, at: nowIso(), message });
}
