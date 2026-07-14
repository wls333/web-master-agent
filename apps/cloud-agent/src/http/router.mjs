import { createReadStream } from "node:fs";
import path from "node:path";
import { accepted, created, error, json, ok, readJson } from "./responses.mjs";
import { mergeConfig, publicConfig, saveUserConfig } from "../config.mjs";

export class Router {
  constructor({ config, store, services, appRoot }) {
    this.config = config;
    this.store = store;
    this.services = services;
    this.appRoot = appRoot;
    this.routes = new Map();
    this.register();
  }

  register() {
    this.get("/", this.serveIndex.bind(this));
    this.get("/assets/app.css", this.serveAsset("public/app.css", "text/css; charset=utf-8"));
    this.get("/assets/app.js", this.serveAsset("public/app.js", "text/javascript; charset=utf-8"));
    this.get("/api/health", async (_req, res) => ok(res, {
      status: "ok",
      agent: this.config.agentName,
      project: this.config.project,
      time: new Date().toISOString()
    }));
    this.get("/api/config", async (_req, res) => ok(res, publicConfig(this.config)));
    this.patch("/api/config", async (req, res) => {
      const patch = await readJson(req);
      await saveUserConfig(patch);
      mergeConfig(this.config, patch);
      await this.store.appendAudit({
        action: "config.update",
        riskLevel: "L1_DIAGNOSTIC",
        decision: "allow",
        status: "success",
        target: { type: "config", id: "local" },
        summary: "Cloud Agent configuration updated"
      });
      ok(res, publicConfig(this.config));
    });
    this.get("/api/state", async (_req, res) => ok(res, this.publicState()));
    this.get("/api/audit", async (_req, res) => ok(res, this.store.getState().audit || []));

    this.get("/api/scans", async (_req, res) => ok(res, this.store.listScans()));
    this.post("/api/scans", async (_req, res) => ok(res, await this.services.scan.runScan()));
    this.post("/api/scan", async (_req, res) => ok(res, await this.services.scan.runScan()));

    this.get("/api/incidents", async (_req, res) => ok(res, this.store.listIncidents()));
    this.post("/api/incidents", async (req, res) => created(res, await this.services.incident.createIncident(await readJson(req))));
    this.get("/api/local-fix-tasks", async (_req, res) => ok(res, this.store.listLocalFixTasks()));

    this.get("/api/deployments", async (_req, res) => ok(res, this.services.deployment.list()));
    this.post("/api/deployments/validate", async (req, res) => {
      const result = await this.services.deployment.validate(await readJson(req));
      json(res, result.ok ? 200 : 422, result);
    });
    this.post("/api/deploy/validate", async (req, res) => {
      const result = await this.services.deployment.validate(await readJson(req));
      json(res, result.ok ? 200 : 422, result);
    });
    this.post("/api/deployments", async (req, res) => {
      const result = await this.services.deployment.create(await readJson(req));
      if (!result.ok) return json(res, 422, result);
      accepted(res, result.deployment);
    });
    this.post("/api/deploy", async (req, res) => {
      const result = await this.services.deployment.create(await readJson(req));
      if (!result.ok) return json(res, 422, result);
      accepted(res, result.deployment);
    });
  }

  async handle(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const dynamic = this.matchDynamic(req.method, url.pathname);
    const route = this.routes.get(`${req.method} ${url.pathname}`) || dynamic?.handler;
    try {
      if (!route) return error(res, 404, "not_found", "Route not found");
      req.params = dynamic?.params || {};
      await route(req, res);
    } catch (err) {
      console.error(err);
      error(res, 500, "internal_error", err instanceof Error ? err.message : String(err));
    }
  }

  get(pathname, handler) {
    this.routes.set(`GET ${pathname}`, handler);
  }

  post(pathname, handler) {
    this.routes.set(`POST ${pathname}`, handler);
  }

  patch(pathname, handler) {
    this.routes.set(`PATCH ${pathname}`, handler);
  }

  matchDynamic(method, pathname) {
    const deploymentDetail = pathname.match(/^\/api\/deployments\/([^/]+)$/);
    if (method === "GET" && deploymentDetail) {
      return {
        params: { id: decodeURIComponent(deploymentDetail[1]) },
        handler: async (req, res) => {
          const deployment = this.services.deployment.get(req.params.id);
          if (!deployment) return error(res, 404, "not_found", "Deployment not found");
          ok(res, deployment);
        }
      };
    }

    const rollback = pathname.match(/^\/api\/deployments\/([^/]+)\/rollback$/);
    if (method === "POST" && rollback) {
      return {
        params: { id: decodeURIComponent(rollback[1]) },
        handler: async (req, res) => {
          const result = await this.services.deployment.rollback(req.params.id, await readJson(req));
          if (!result.ok) return json(res, 422, result);
          accepted(res, result.deployment);
        }
      };
    }

    const scanDetail = pathname.match(/^\/api\/scans\/([^/]+)$/);
    if (method === "GET" && scanDetail) {
      return {
        params: { id: decodeURIComponent(scanDetail[1]) },
        handler: async (req, res) => {
          const scan = this.store.getScan(req.params.id);
          if (!scan) return error(res, 404, "not_found", "Scan not found");
          ok(res, scan);
        }
      };
    }

    const auditDetail = pathname.match(/^\/api\/audit\/([^/]+)$/);
    if (method === "GET" && auditDetail) {
      return {
        params: { id: decodeURIComponent(auditDetail[1]) },
        handler: async (req, res) => {
          const audit = (this.store.getState().audit || []).find((item) => item.id === req.params.id);
          if (!audit) return error(res, 404, "not_found", "Audit event not found");
          ok(res, audit);
        }
      };
    }

    const localFixTaskDetail = pathname.match(/^\/api\/local-fix-tasks\/([^/]+)$/);
    if (method === "GET" && localFixTaskDetail) {
      return {
        params: { id: decodeURIComponent(localFixTaskDetail[1]) },
        handler: async (req, res) => {
          const task = this.store.getLocalFixTask(req.params.id);
          if (!task) return error(res, 404, "not_found", "LocalFixTask not found");
          ok(res, task);
        }
      };
    }

    const incidentDetail = pathname.match(/^\/api\/incidents\/([^/]+)$/);
    if (method === "GET" && incidentDetail) {
      return {
        params: { id: decodeURIComponent(incidentDetail[1]) },
        handler: async (req, res) => {
          const incident = this.store.getIncident(req.params.id);
          if (!incident) return error(res, 404, "not_found", "Incident not found");
          ok(res, incident);
        }
      };
    }

    const incidentPatch = pathname.match(/^\/api\/incidents\/([^/]+)$/);
    if (method === "PATCH" && incidentPatch) {
      return {
        params: { id: decodeURIComponent(incidentPatch[1]) },
        handler: async (req, res) => {
          const result = await this.services.incident.updateIncident(req.params.id, await readJson(req));
          if (!result.ok) return json(res, 422, result);
          ok(res, result.incident);
        }
      };
    }

    const incidentLocalFix = pathname.match(/^\/api\/incidents\/([^/]+)\/local-fix-task$/);
    if (method === "POST" && incidentLocalFix) {
      return {
        params: { id: decodeURIComponent(incidentLocalFix[1]) },
        handler: async (req, res) => {
          const result = await this.services.incident.createLocalFixTask(req.params.id, await readJson(req));
          if (!result.ok) return json(res, 422, result);
          created(res, result.task);
        }
      };
    }
    return null;
  }

  async serveIndex(_req, res) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    createReadStream(path.join(this.appRoot, "public/index.html")).pipe(res);
  }

  serveAsset(relativePath, contentType) {
    return async (_req, res) => {
      res.writeHead(200, { "content-type": contentType });
      createReadStream(path.join(this.appRoot, relativePath)).pipe(res);
    };
  }

  publicState() {
    const state = this.store.getState();
    return {
      agent: {
        name: this.config.agentName,
        bindHost: this.config.bindHost,
        port: this.config.port,
        bootedAt: state.bootedAt
      },
      project: this.config.project,
      latestScan: state.scans?.[0] || null,
      incidents: (state.incidents || []).slice(0, 10),
      deployments: (state.deployments || []).slice(0, 10),
      localFixTasks: (state.localFixTasks || []).slice(0, 10),
      audit: (state.audit || []).slice(0, 20)
    };
  }
}
