import { createApp } from "./app.mjs";

const { config, server } = await createApp();

server.listen(config.port, config.bindHost, () => {
  console.log(`LightOps Cloud Agent listening on http://${config.bindHost}:${config.port}`);
  console.log(`Project: ${config.project?.name || config.project?.id || "unconfigured"}`);
});
