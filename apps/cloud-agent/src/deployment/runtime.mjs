import { id, nowIso } from "../util/ids.mjs";

export async function createDryRunDeployment(spec, validation, config) {
  const revision = `${spec.artifact?.tag || "unknown"}-${Date.now()}`;
  const timeline = [];
  push(timeline, "validating", "DeploySpec validated");
  push(timeline, "preflight", "Preflight passed in dry-run mode");
  push(timeline, "pulling_artifact", "Image pull skipped because allowRealDeploy=false");
  push(timeline, "preparing_revision", "Dry-run revision metadata created");
  push(timeline, "probing", "Health probe planned but not executed against new revision");
  push(timeline, "observing", "Observation window simulated");
  push(timeline, "succeeded", "No production resource was changed");
  return {
    id: id("dep"),
    service: spec.service || config.project?.id || "service",
    env: spec.env || "prod",
    runtime: validation.normalized.runtime,
    artifact: spec.artifact,
    state: "succeeded",
    status: "simulated_success",
    dryRun: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    revision,
    healthcheck: spec.healthcheck,
    rollback: validation.normalized.rollback,
    timeline,
    notes: ["Dry-run mode: revision recorded, no container/process was changed."]
  };
}

export async function createDryRunRollback({ deployment, target }) {
  const timeline = [];
  push(timeline, "validating", "Rollback request validated");
  push(timeline, "rolling_back", `Dry-run rollback target selected: ${target?.revision || "none"}`);
  push(timeline, "rolled_back", "No production resource was changed");
  return {
    ...deployment,
    state: "rolled_back",
    status: "simulated_rollback",
    updatedAt: nowIso(),
    rollbackResult: {
      dryRun: true,
      targetDeploymentId: target?.id || null,
      targetRevision: target?.revision || null,
      completedAt: nowIso()
    },
    timeline: [...(deployment.timeline || []), ...timeline],
    notes: [...(deployment.notes || []), "Dry-run rollback recorded."]
  };
}

function push(timeline, state, message) {
  timeline.push({ state, at: nowIso(), message });
}
