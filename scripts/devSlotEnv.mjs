// The six values one slot number decides. Any of them left at a default
// reproduces the bug this whole scheme exists to kill: a frontend that
// renders fine while reading another branch's database.

import { join } from "node:path";
import { upsertEnvLine } from "./devEnvFile.mjs";

export function applySlotEnv({ repoRoot, ports, transport = "loopback", lanAddress }) {
  if (transport === "lan" && !lanAddress) {
    throw new Error("transport 'lan' needs a lan address — pickLanAddress() returned nothing");
  }
  const apiHost = transport === "lan" ? lanAddress : "127.0.0.1";

  const backendEnv = join(repoRoot, "backend", ".env");
  const frontendEnv = join(repoRoot, "frontend", ".env.local");
  const mobileEnv = join(repoRoot, "mobile", ".env.local");

  upsertEnvLine(backendEnv, "PORT", String(ports.backend));
  upsertEnvLine(backendEnv, "FRONTEND_URL", `http://localhost:${ports.vite}`);
  upsertEnvLine(frontendEnv, "VITE_API_PORT", String(ports.backend));
  // Vite's own listen port. Without this, Vite always binds the plugin
  // default (5173) no matter which slot backend/.env's FRONTEND_URL names,
  // so the browser gets CORS-rejected by its own backend — see Finding C2.
  upsertEnvLine(frontendEnv, "VITE_PORT", String(ports.vite));
  upsertEnvLine(mobileEnv, "EXPO_PUBLIC_API_URL", `http://${apiHost}:${ports.backend}`);

  return { backendEnv, frontendEnv, mobileEnv };
}
