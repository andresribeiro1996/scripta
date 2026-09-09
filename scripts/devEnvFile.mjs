// Shared by dev-account.mjs and dev-emulator.mjs, which write different
// keys (EXPO_PUBLIC_DEV_REFRESH_TOKEN and EXPO_PUBLIC_API_URL) into the
// SAME file — mobile/.env.local, auto-loaded by @expo/env (see its own
// index.js: .env.local is one of the "local" files EXPO_PUBLIC_* secrets
// are specifically allowed to come from). One helper means neither
// script's write can clobber the other's line.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Replaces (or appends) a single KEY=value line in an .env-style file,
 *  leaving every other line untouched. */
export function upsertEnvLine(path, key, value) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = existing.split("\n").filter((line) => line.trim() !== "");
  const prefix = `${key}=`;
  const idx = lines.findIndex((line) => line.startsWith(prefix));
  const newLine = `${prefix}${value}`;
  if (idx === -1) lines.push(newLine);
  else lines[idx] = newLine;
  writeFileSync(path, lines.join("\n") + "\n");
}
