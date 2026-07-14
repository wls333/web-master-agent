import { validateDeploySpec } from "../deployment/deployspec-validator.mjs";
import { createDryRunDeployment, createDryRunRollback } from "../deployment/runtime.mjs";
import { executeContainerDeployment } from "../deployment/container-runtime.mjs";
import { decidePolicy } from "../security/policy.mjs";

export class DeploymentService {
  constructor({ config, store, locks }) {
    this.config = config;
    this.store = store;
    this.locks = locks;
  }

  list() {
    return this.store.listDeployments();
  }

  get(id) {
    return this.store.getDeployment(id);
  }

  async validate(spec = {}) {
    const validation = validateDeploySpec(spec);
    const policy = decidePolicy("deploy.validate", {
      inlineSecretDetected: validation.inlineSecretDetected
    });
    await this.store.appendAudit({
      action: "deploy.validate",
      riskLevel: policy.riskLevel,
      decision: policy.decision,
      status: validation.ok ? "success" : "blocked",
      target: { type: "deployment", id: spec.service || "unknown" },
      summary: validation.ok ? "DeploySpec validated" : "DeploySpec blocked",
      details: { errors: validation.errors, warnings: validation.warnings }
    });
    return validation;
  }

  async create(spec = {}) {
    const validation = validateDeploySpec(spec);
    const realDeploy = Boolean(this.config.deployment?.allowRealDeploy);
    const service = spec.service || this.config.project?.id || "service";
    const env = spec.env || "prod";
    const policy = decidePolicy("deploy.create", {
      env,
      realDeploy,
      inlineSecretDetected: validation.inlineSecretDetected,
      approved: Boolean(spec.approved)
    });
    if (!validation.ok || policy.decision !== "allow") {
      await this.store.appendAudit({
        action: "deploy.create",
        riskLevel: policy.riskLevel,
        decision: policy.decision,
        status: "blocked",
        target: { type: "deployment", id: spec.service || "unknown" },
        summary: policy.reason || "DeploySpec validation failed",
        details: { errors: validation.errors, warnings: validation.warnings }
      });
      return { ok: false, validation, policy };
    }

    const lockResource = `deployment:${service}:${env}`;
    const lockOwner = `deploy:${Date.now()}`;
    const lock = this.locks.acquire(lockResource, lockOwner);
    if (!lock.ok) {
      await this.store.appendAudit({
        action: "deploy.create",
        riskLevel: policy.riskLevel,
        decision: "deny",
        status: "blocked",
        target: { type: "deployment", id: service },
        summary: lock.message
      });
      return { ok: false, error: { code: "resource_locked", message: lock.message } };
    }

    try {
      const deployment = realDeploy && validation.normalized.runtime === "agent-container"
        ? await executeContainerDeployment({ ...spec, service, env }, validation, this.config)
        : await createDryRunDeployment({ ...spec, service, env }, validation, this.config);
      await this.store.saveDeployment(deployment, this.config.deployment?.keepRevisions || 5);
      await this.store.appendAudit({
        action: "deploy.create",
        riskLevel: policy.riskLevel,
        decision: policy.decision,
        status: deployment.status,
        target: { type: "deployment", id: deployment.id },
        summary: "Deployment dry-run created",
        details: { dryRun: deployment.dryRun, service: deployment.service, env: deployment.env }
      });
      return { ok: true, deployment };
    } finally {
      this.locks.release(lockResource, lockOwner);
    }
  }

  async rollback(id, input = {}) {
    const deployment = this.store.getDeployment(id);
    if (!deployment) {
      return { ok: false, error: { code: "not_found", message: "Deployment not found" } };
    }
    const realDeploy = Boolean(this.config.deployment?.allowRealDeploy);
    const policy = decidePolicy("deploy.rollback", {
      env: deployment.env || "prod",
      realDeploy,
      approved: Boolean(input.approved)
    });
    if (policy.decision !== "allow") {
      await this.store.appendAudit({
        action: "deploy.rollback",
        riskLevel: policy.riskLevel,
        decision: policy.decision,
        status: "blocked",
        target: { type: "deployment", id },
        summary: policy.reason || "Rollback blocked"
      });
      return { ok: false, policy };
    }

    const service = deployment.service;
    const env = deployment.env || "prod";
    const lockResource = `deployment:${service}:${env}`;
    const lockOwner = `rollback:${id}`;
    const lock = this.locks.acquire(lockResource, lockOwner);
    if (!lock.ok) {
      return { ok: false, error: { code: "resource_locked", message: lock.message } };
    }

    try {
      const target = input.targetDeploymentId
        ? this.store.getDeployment(input.targetDeploymentId)
        : this.findRollbackTarget(deployment);
      const updated = await createDryRunRollback({ deployment, target });
      await this.store.saveDeployment(updated, this.config.deployment?.keepRevisions || 5);
      await this.store.appendAudit({
        action: "deploy.rollback",
        riskLevel: policy.riskLevel,
        decision: policy.decision,
        status: updated.status,
        target: { type: "deployment", id },
        summary: "Deployment rollback dry-run recorded",
        details: { targetDeploymentId: target?.id || null, targetRevision: target?.revision || null }
      });
      return { ok: true, deployment: updated };
    } finally {
      this.locks.release(lockResource, lockOwner);
    }
  }

  findRollbackTarget(deployment) {
    return this.store.listDeployments().find((item) =>
      item.id !== deployment.id &&
      item.service === deployment.service &&
      item.env === deployment.env &&
      item.state === "succeeded"
    ) || null;
  }
}
