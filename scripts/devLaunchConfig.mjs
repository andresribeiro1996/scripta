import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function buildLaunchConfig({ ports, https }) {
  return {
    version: "0.0.1",
    configurations: [
      {
        name: "web",
        runtimeExecutable: "npm",
        runtimeArgs: ["run", "frontend"],
        port: ports.vite,
        url: `${https ? "https" : "http"}://localhost:${ports.vite}`,
      },
      { name: "api", runtimeExecutable: "npm", runtimeArgs: ["run", "backend"], port: ports.backend },
    ],
  };
}

export function writeLaunchConfig({ repoRoot, ports, https }) {
  const dir = join(repoRoot, ".claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "launch.json"), `${JSON.stringify(buildLaunchConfig({ ports, https }), null, 2)}\n`);
}
