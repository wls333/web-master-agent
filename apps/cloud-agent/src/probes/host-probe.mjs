import os from "node:os";

export async function collectHostProbe() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptimeSeconds: os.uptime(),
    cpuCount: os.cpus()?.length || 0,
    load1m: os.loadavg()[0],
    totalMem,
    freeMem,
    memoryUsedRatio: totalMem ? Number(((totalMem - freeMem) / totalMem).toFixed(3)) : null
  };
}
