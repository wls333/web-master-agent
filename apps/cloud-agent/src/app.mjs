import http from "node:http";
import { loadConfig, paths } from "./config.mjs";
import { FileStore } from "./store/file-store.mjs";
import { ScanService } from "./services/scan-service.mjs";
import { IncidentService } from "./services/incident-service.mjs";
import { DeploymentService } from "./services/deployment-service.mjs";
import { Router } from "./http/router.mjs";
import { LockManager } from "./util/locks.mjs";

export async function createApp() {
  const config = await loadConfig();
  const store = await new FileStore(config.dataDirAbs).init();
  const locks = new LockManager();
  const services = {};
  services.scan = new ScanService({ config, store, workspaceRoot: paths.workspaceRoot });
  services.incident = new IncidentService({ config, store, scanService: services.scan });
  services.deployment = new DeploymentService({ config, store, locks });
  const router = new Router({ config, store, services, appRoot: paths.appRoot });
  const server = http.createServer((req, res) => router.handle(req, res));
  return { config, store, services, router, server };
}
