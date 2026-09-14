import { cpus, totalmem } from "node:os";
import { collectDevices, orphanSerials, readAdbSerials } from "./devDevices.mjs";
import { DEFAULT_LIMITS, readHost } from "./devHost.mjs";
import { readListeners } from "./devListeners.mjs";
import { readProcessTable, sumSubtree } from "./devProcessTable.mjs";
import { isPidAlive, portsForSlot, readRegistry, registryPath } from "./devRegistry.mjs";
import { processCwd } from "./devTeardown.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

export function connectionUrls({ ports, lanAddress }) {
  return {
    webLocal: `http://localhost:${ports.vite}`,
    webLan: lanAddress ? `http://${lanAddress}:${ports.vite}` : null,
    expoLan: lanAddress ? `exp://${lanAddress}:${ports.metro}` : null,
    expoEmulator: `exp://127.0.0.1:${ports.metro}`,
  };
}

// The same rule isSlotLive() claims by: a dead recorded pid is NOT enough
// to call a slot stale. dev-emulator.mjs spawns the backend and Metro
// detached and then exits, so the claiming pid is gone within seconds
// while the stack it started keeps its ports bound. Stale means dead pid
// AND nothing listening on any of the three ports — a worktree that
// crashed before binding anything.
export function slotState({ entry, ports, listeners }) {
  if (isPidAlive(entry.pid)) return "live";
  const bound = Object.values(ports).some((port) => (listeners[port] ?? []).length > 0);
  return bound ? "live" : "stale";
}

export function auditPorts({ ports, listeners, worktree, cwdForPid }) {
  return [
    ["backend", ports.backend],
    ["vite", ports.vite],
    ["metro", ports.metro],
  ].map(([role, port]) => {
    const pids = listeners[port] ?? [];
    const foreignPids = pids.flatMap((pid) => {
      const cwd = cwdForPid(pid);
      // An unresolvable cwd is never reported as foreign: the same
      // safe-default devTeardown.pidsToTeardown takes, for the same
      // reason — a false accusation here sends someone hunting a
      // collision that isn't there.
      if (typeof cwd !== "string" || cwd.length === 0) return [];
      const inside = cwd === worktree || cwd.startsWith(`${worktree}/`);
      return inside ? [] : [{ pid, cwd }];
    });
    return { role, port, pids, foreignPids };
  });
}

export function buildStacks({ registry, rows, listeners, lanAddress, cwdForPid = processCwd }) {
  return Object.keys(registry.slots)
    .map(Number)
    .sort((a, b) => a - b)
    .map((slot) => {
      const entry = registry.slots[String(slot)];
      const ports = portsForSlot(slot);
      const portAudit = auditPorts({ ports, listeners, worktree: entry.worktree, cwdForPid });

      const roleByPid = new Map(portAudit.flatMap(({ role, pids }) => pids.map((pid) => [pid, role])));
      // Every pid the slot owns: the recorded claimer's subtree plus each
      // listener's subtree. They are usually disjoint — the claimer exits
      // and the servers it spawned are reparented to launchd — so both
      // roots must be walked, and the union deduped.
      const roots = [entry.pid, ...portAudit.flatMap(({ pids }) => pids)];
      const byPid = new Map(rows.map((row) => [row.pid, row]));
      const owned = new Map();
      for (const root of roots) {
        for (const pid of sumSubtree(root, rows).pids) owned.set(pid, byPid.get(pid));
      }

      const processes = [...owned.values()].map((row) => ({
        pid: row.pid,
        role: roleByPid.get(row.pid) ?? "other",
        rss: row.rss,
        cpu: row.cpu,
        alive: true,
      }));

      return {
        slot,
        worktree: entry.worktree,
        branch: entry.branch,
        session: entry.session ?? null,
        claimedAt: entry.claimedAt ?? null,
        state: slotState({ entry, ports, listeners }),
        ports,
        processes,
        rssTotalMB: Math.round(processes.reduce((total, p) => total + p.rss, 0) / 1024),
        cpuTotal: Number(processes.reduce((total, p) => total + p.cpu, 0).toFixed(1)),
        portAudit,
        urls: connectionUrls({ ports, lanAddress }),
      };
    });
}

export const DEVICE_LEASE_WARN_MS = 30 * 60 * 1000;

export function statusWarnings({ host, stacks, devices, orphans, limits = DEFAULT_LIMITS, now = Date.now() }) {
  const warnings = [];

  if (host.freeBytes < limits.minFreeBytes) {
    warnings.push(
      `only ${(host.freeBytes / 1024 ** 3).toFixed(1)} GB of memory available — ` +
        `below the ${(limits.minFreeBytes / 1024 ** 3).toFixed(0)} GB floor, so the next stack will be refused at boot.`,
    );
  }
  if (host.loadAvg1 > limits.maxLoadForSecondEmulator) {
    warnings.push(
      `1-minute load average is ${host.loadAvg1.toFixed(1)} — above the ${limits.maxLoadForSecondEmulator} limit for a second emulator.`,
    );
  }
  if (!host.lanAddress) {
    warnings.push("no LAN address resolved — phone URLs are unavailable until this machine has one.");
  }

  for (const stack of stacks) {
    if (stack.state === "stale") {
      // Only one warning for a stale slot: its ports are silent by
      // definition, so also listing each silent port would be three
      // lines saying the same thing.
      warnings.push(`slot ${stack.slot} (${stack.branch}) is stale — its pid is gone and nothing holds its ports. Run \`npm run dev:release\` in that worktree.`);
      continue;
    }
    for (const { role, port, pids, foreignPids } of stack.portAudit) {
      if (pids.length === 0) {
        warnings.push(`slot ${stack.slot} (${stack.branch}) claims ${role} :${port}, but nothing is listening on it.`);
      }
      for (const { pid, cwd } of foreignPids) {
        warnings.push(`slot ${stack.slot} (${stack.branch}) claims ${role} :${port}, but pid ${pid} holds it from ${cwd}.`);
      }
    }
  }

  for (const device of devices) {
    if (device.heldMs !== null && device.heldMs > DEVICE_LEASE_WARN_MS) {
      warnings.push(
        `${device.avd} has been held by ${device.holder} for ${Math.round(device.heldMs / 60000)} minutes — likely a forgotten lease.`,
      );
    }
  }
  for (const serial of orphans) {
    warnings.push(`${serial} is running but no worktree holds a lease on it.`);
  }

  return warnings;
}

export function collectStatus({
  repoRoot = process.cwd(),
  registry = readRegistry(registryPath(repoRoot)),
  rows = readProcessTable(),
  listeners = readListeners(),
  serials = readAdbSerials(),
  hostReading = readHost(),
  lanAddress = pickLanAddress(),
  limits = DEFAULT_LIMITS,
  cwdForPid = processCwd,
  now = Date.now(),
} = {}) {
  const host = {
    lanAddress: lanAddress ?? null,
    totalMemGB: Number((totalmem() / 1024 ** 3).toFixed(1)),
    freeMemGB: Number((hostReading.freeBytes / 1024 ** 3).toFixed(1)),
    freeBytes: hostReading.freeBytes,
    loadAvg1: Number(hostReading.loadAvg1.toFixed(2)),
    cores: cpus().length,
  };
  const stacks = buildStacks({ registry, rows, listeners, lanAddress, cwdForPid });
  const devices = collectDevices({ registry, rows, now });
  const orphans = orphanSerials(registry, serials);
  const warnings = statusWarnings({ host, stacks, devices, orphans, limits, now });
  return { host, stacks, devices, orphans, limits, warnings };
}
