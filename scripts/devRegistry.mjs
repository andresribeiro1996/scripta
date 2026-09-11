// One slot per worktree. Every dev port this repo binds derives from it,
// so two worktrees can never land on the same number — see
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md.

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

// signal 0 sends nothing but still validates the pid: ESRCH means it's
// gone, EPERM means it exists but is owned by someone else (still alive).
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

export function slotForWorktree(registry, worktree) {
  return Object.keys(registry.slots).find((slot) => registry.slots[slot].worktree === worktree);
}

// Claims the lowest free slot for a worktree, or reuses the one it already
// holds. A slot counts as free only when its previous holder's pid is dead
// AND its ports are actually unbound — isPortFree is injected (sync) so
// tests need no real sockets; the production default lives in Task 4.
export function claimSlot({ path, worktree, branch, pid, session, isPrimary, isPortFree }) {
  return withLock(path, () => {
    const registry = readRegistry(path);

    const existing = slotForWorktree(registry, worktree);
    if (existing !== undefined) {
      registry.slots[existing] = { worktree, branch, pid, session, claimedAt: new Date().toISOString() };
      writeRegistry(path, registry);
      return { slot: Number(existing), ports: portsForSlot(Number(existing)) };
    }

    const held = (slot) => {
      const entry = registry.slots[String(slot)];
      return entry !== undefined && isPidAlive(entry.pid);
    };

    const candidates = isPrimary ? [0] : Array.from({ length: MAX_SLOT }, (_, i) => i + 1);
    for (const slot of candidates) {
      if (held(slot)) continue;
      const ports = portsForSlot(slot);
      if (!Object.values(ports).every((port) => isPortFree(port))) continue;
      registry.slots[String(slot)] = { worktree, branch, pid, session, claimedAt: new Date().toISOString() };
      writeRegistry(path, registry);
      return { slot, ports };
    }
    throw new Error(`no free slot in 0..${MAX_SLOT} — run \`npm run dev:status\` to see what holds them`);
  });
}

// Also clears any device lease this worktree held (Task 5 adds takeDevice /
// releaseDevice on top of registry.devices, which Task 2's EMPTY_REGISTRY
// already defines) so a released worktree never leaves a stale device lock.
export function releaseSlot({ path, worktree }) {
  withLock(path, () => {
    const registry = readRegistry(path);
    const slot = slotForWorktree(registry, worktree);
    if (slot === undefined) return;
    delete registry.slots[slot];
    for (const [avd, lease] of Object.entries(registry.devices)) {
      if (lease?.worktree === worktree) registry.devices[avd] = null;
    }
    writeRegistry(path, registry);
  });
}

// Exactly two AVDs exist on the shared machine, so the device lease is a
// two-slot semaphore rather than a per-worktree mutex like claimSlot above:
// two worktrees may each hold one emulator, but a third must wait or steal
// a dead one.
export const AVDS = ["scripta-dev-0", "scripta-dev-1"];

export function deviceHolders(registry) {
  return AVDS.flatMap((avd) => {
    const lease = registry.devices[avd];
    return lease ? [{ avd, ...lease }] : [];
  });
}

// Hands out the lowest free AVD, reusing whatever this worktree already
// holds so re-running the dev script doesn't grab a second emulator. When
// both are live-held, the error names both holders and when each was taken
// — contention must be loud and attributable, never a silent steal of
// someone else's adb tunnel.
export function takeDevice({ path, worktree, pid, avd }) {
  return withLock(path, () => {
    const registry = readRegistry(path);
    const free = (name) => {
      const lease = registry.devices[name];
      return lease === null || lease === undefined || !isPidAlive(lease.pid);
    };
    const mine = AVDS.find((name) => registry.devices[name]?.worktree === worktree);
    if (mine !== undefined) return { avd: mine };

    const wanted = avd ? [avd] : AVDS;
    const chosen = wanted.find(free);
    if (chosen === undefined) {
      const held = deviceHolders(registry)
        .map((holder) => `  ${holder.avd} — ${holder.worktree} since ${holder.takenAt}`)
        .join("\n");
      throw new Error(`every emulator is leased:\n${held}\nWait for one, or release it from that worktree.`);
    }
    registry.devices[chosen] = { worktree, pid, takenAt: new Date().toISOString() };
    writeRegistry(path, registry);
    return { avd: chosen };
  });
}

// Releases only the lease(s) this worktree holds — pass `avd` to release a
// specific one, or omit it to release everything this worktree has.
export function releaseDevice({ path, worktree, avd }) {
  withLock(path, () => {
    const registry = readRegistry(path);
    for (const name of AVDS) {
      const lease = registry.devices[name];
      if (!lease) continue;
      if (lease.worktree === worktree && (avd === undefined || avd === name)) registry.devices[name] = null;
    }
    writeRegistry(path, registry);
  });
}
