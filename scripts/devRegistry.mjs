// One slot per worktree. Every dev port this repo binds derives from it,
// so two worktrees can never land on the same number — see
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md.

export const MAX_SLOT = 15;
export const BACKEND_BASE = 3000;
export const VITE_BASE = 5173;
export const METRO_BASE = 8081;

export function portsForSlot(slot) {
  if (!Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT) {
    throw new Error(`slot must be an integer in 0..${MAX_SLOT}, got ${slot}`);
  }
  return {
    backend: BACKEND_BASE + 100 * slot,
    vite: VITE_BASE + 100 * slot,
    metro: METRO_BASE + 100 * slot,
  };
}

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK_STALE_MS = 10_000;

export const EMPTY_REGISTRY = {
  version: 1,
  slots: {},
  devices: { "scripta-dev-0": null, "scripta-dev-1": null },
};

// Inside .git, so it is shared by every worktree of this clone, never
// version-controlled, and disappears with the clone. --path-format=absolute
// matters: the bare form returns a relative ".git" in the primary checkout.
export function registryPath(cwd = process.cwd()) {
  const gitDir = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd,
    encoding: "utf8",
  }).trim();
  return join(gitDir, "scripta-dev.json");
}

export function readRegistry(path) {
  if (!existsSync(path)) return structuredClone(EMPTY_REGISTRY);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return {
      version: parsed.version ?? 1,
      slots: parsed.slots ?? {},
      devices: { ...EMPTY_REGISTRY.devices, ...(parsed.devices ?? {}) },
    };
  } catch {
    return structuredClone(EMPTY_REGISTRY);
  }
}

export function writeRegistry(path, registry) {
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`);
}

// Blocks synchronously for ~100ms without spawning a process (no `sleep`
// child, which would also make this non-portable to shells lacking it).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withLock(path, fn) {
  const lockPath = `${path}.lock`;
  let fd;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      fd = openSync(lockPath, "wx");
      break;
    } catch {
      // A competing holder may release the lock between our failed openSync
      // and this stat, so ENOENT here just means "retry immediately" rather
      // than a real failure.
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) rmSync(lockPath, { force: true });
        else sleepSync(100);
      } catch {
        // Lock file vanished underneath us — retry immediately.
      }
    }
  }
  if (fd === undefined) throw new Error(`could not acquire ${lockPath}`);
  try {
    writeFileSync(lockPath, String(process.pid));
    return fn();
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}
