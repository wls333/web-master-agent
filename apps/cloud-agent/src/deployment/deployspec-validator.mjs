export function validateDeploySpec(spec = {}) {
  const errors = [];
  const warnings = [];
  let inlineSecretDetected = false;

  if (!spec || typeof spec !== "object") errors.push("DeploySpec must be a JSON object");
  if (!spec.service) errors.push("service is required");
  if (!spec.runtime) warnings.push("runtime missing; agent-container will be used");
  if (!spec.artifact?.image) errors.push("artifact.image is required");
  if (!spec.artifact?.tag && !spec.artifact?.digest) errors.push("artifact.tag or artifact.digest is required");
  if (!spec.healthcheck?.url && !spec.healthcheck?.path) warnings.push("healthcheck is missing; production promotion should be blocked");
  for (const port of spec.container?.ports || []) {
    for (const field of ["container_port", "host_port"]) {
      if (port[field] !== undefined && (!Number.isInteger(Number(port[field])) || Number(port[field]) < 1 || Number(port[field]) > 65535)) {
        errors.push(`${field} must be between 1 and 65535`);
      }
    }
  }
  for (const [key, value] of Object.entries(spec.container?.env || {})) {
    if (/password|secret|token|key/i.test(key) && String(value).length > 0) {
      inlineSecretDetected = true;
      errors.push(`sensitive env ${key} must use secret_refs instead of inline value`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    inlineSecretDetected,
    normalized: {
      ...spec,
      runtime: spec.runtime || "agent-container",
      rollback: spec.rollback || { strategy: "previous_successful_deploy", keepRevisions: 5 }
    }
  };
}
