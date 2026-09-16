// The seven values one slot number decides. Any of them left at a default
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
  // The base every ABSOLUTE image url the API hands out is built on
  // (covers' /covers/cached/:id/file, gallery's /gallery/:id/file, auth
  // avatars). backend/.env.example pins it to localhost:3000 and
  // ensureBackendEnv copies that line verbatim, so without this a
  // non-default slot served cover urls pointing at whatever happens to
  // own port 3000 — a 404 on a good day, another worktree's images on a
  // bad one. Uses apiHost, not localhost, so these match the origin the
  // mobile client is told to call in EXPO_PUBLIC_API_URL below.
  upsertEnvLine(backendEnv, "PUBLIC_API_URL", `http://${apiHost}:${ports.backend}`);
  upsertEnvLine(frontendEnv, "VITE_API_PORT", String(ports.backend));
  // Vite's own listen port. Without this, Vite always binds the plugin
  // default (5173) no matter which slot backend/.env's FRONTEND_URL names,
  // so the browser gets CORS-rejected by its own backend — see Finding C2.
  upsertEnvLine(frontendEnv, "VITE_PORT", String(ports.vite));
  upsertEnvLine(mobileEnv, "EXPO_PUBLIC_API_URL", `http://${apiHost}:${ports.backend}`);

  return { backendEnv, frontendEnv, mobileEnv };
}
