import { runCommand } from "../util/process.mjs";

export async function collectCommandProbe() {
  const checks = [
    ["node", ["--version"]],
    ["docker", ["--version"]],
    ["podman", ["--version"]],
    ["java", ["-version"]],
    ["nginx", ["-v"]]
  ];
  const results = {};
  await Promise.all(checks.map(async ([cmd, args]) => {
    results[cmd] = await runCommand(cmd, args);
  }));
  return results;
}
