export const RiskLevel = {
  READONLY: "L0_READONLY",
  DIAGNOSTIC: "L1_DIAGNOSTIC",
  RECOVERABLE: "L2_RECOVERABLE",
  PROD_CHANGE: "L3_PROD_CHANGE",
  HIGH_RISK: "L4_HIGH_RISK",
  FORBIDDEN: "L5_FORBIDDEN"
};

export function decidePolicy(action, context = {}) {
  if (action === "shell.exec.freeform") {
    return deny(RiskLevel.FORBIDDEN, "Freeform shell execution is forbidden");
  }
  if (context.inlineSecretDetected) {
    return deny(RiskLevel.FORBIDDEN, "Inline secret values are not allowed");
  }
  if (action === "deploy.create" && context.env === "prod" && context.realDeploy) {
    return context.approved
      ? allow(RiskLevel.PROD_CHANGE)
      : requireApproval(RiskLevel.PROD_CHANGE, "Production deployment requires approval");
  }
  if (action === "deploy.rollback" && context.env === "prod") {
    if (!context.realDeploy) return allow(RiskLevel.DIAGNOSTIC);
    return context.approved
      ? allow(RiskLevel.PROD_CHANGE)
      : requireApproval(RiskLevel.PROD_CHANGE, "Production rollback requires approval");
  }
  if (action.startsWith("scan.") || action.startsWith("incident.")) {
    return allow(RiskLevel.READONLY);
  }
  if (action === "deploy.validate") {
    return allow(RiskLevel.DIAGNOSTIC);
  }
  if (action === "deploy.create") {
    return allow(context.realDeploy ? RiskLevel.PROD_CHANGE : RiskLevel.DIAGNOSTIC);
  }
  return allow(RiskLevel.DIAGNOSTIC);
}

function allow(riskLevel) {
  return { decision: "allow", riskLevel, reason: "" };
}

function deny(riskLevel, reason) {
  return { decision: "deny", riskLevel, reason };
}

function requireApproval(riskLevel, reason) {
  return { decision: "require_approval", riskLevel, reason };
}
