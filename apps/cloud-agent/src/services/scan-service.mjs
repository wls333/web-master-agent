import { id, nowIso } from "../util/ids.mjs";
import { collectHostProbe } from "../probes/host-probe.mjs";
import { collectCommandProbe } from "../probes/command-probe.mjs";
import { collectHttpProbe } from "../probes/http-probe.mjs";
import { collectLogProbe } from "../probes/log-probe.mjs";
import { analyze, calculateScore, summarizeFindings } from "../analyzers/index.mjs";
import { decidePolicy } from "../security/policy.mjs";

export class ScanService {
  constructor({ config, store, workspaceRoot }) {
    this.config = config;
    this.store = store;
    this.workspaceRoot = workspaceRoot;
  }

  async runScan() {
    const policy = decidePolicy("scan.run");
    const startedAt = nowIso();
    const [host, commands, logs, httpProbe] = await Promise.all([
      collectHostProbe(),
      collectCommandProbe(),
      collectLogProbe(this.config.project?.logPaths || [], this.workspaceRoot),
      collectHttpProbe(this.config.project?.healthcheckUrl)
    ]);
    const scanInput = { host, commands, logs, httpProbe };
    const findings = analyze(scanInput, this.config.project);
    const scan = {
      id: id("scan"),
      startedAt,
      finishedAt: nowIso(),
      project: this.config.project,
      host,
      commands,
      logs,
      httpProbe,
      findings,
      score: calculateScore(findings),
      summary: summarizeFindings(findings)
    };
    await this.store.saveScan(scan);
    await this.store.appendAudit({
      action: "scan.run",
      riskLevel: policy.riskLevel,
      decision: policy.decision,
      status: "success",
      target: { type: "scan", id: scan.id },
      summary: "Readiness scan completed"
    });
    return scan;
  }
}
