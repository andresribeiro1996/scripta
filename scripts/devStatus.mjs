import { execFileSync } from "node:child_process";
import { cpus, totalmem } from "node:os";
import { collectDevices, orphanSerials, readAdbSerials } from "./devDevices.mjs";
import { DEFAULT_LIMITS, readHost } from "./devHost.mjs";
import { readListeners } from "./devListeners.mjs";
import { indexProcessTable, readProcessTable, sumSubtree } from "./devProcessTable.mjs";
import { isPidAlive, portsForSlot, readRegistry, registryPath } from "./devRegistry.mjs";
import { mobileCertsExist } from "./mobileCertPaths.mjs";
import { processCwd } from "./devTeardown.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

// The web scheme is not a guess: frontend/vite.config.ts serves https
// exactly when scripts/gen-mobile-certs.mjs has written the pair
// (`mobileCertsExist() ? {key, cert} : undefined`), in plain `npm run
// frontend` as much as in dev:mobile, because a service worker only runs
// in a secure context and a LAN address over plain http is not one. So
// this reads the same predicate vite.config.ts does rather than assuming
// http — a link with the wrong scheme is a link that cannot be tapped.
// Whether whatever holds `port` speaks TLS, decided by attempting a real
// handshake rather than inferring it. The API's scheme is NOT derivable
// from the certs on disk the way vite's is: only `npm run dev:mobile`
// sets DEV_HTTPS_CERT_PATH (backend/src/config/devCerts.ts), and it
// passes it as spawn env, so nothing on disk records which mode a
// running backend was started in — in plain `npm run backend` the API is
// http while vite is still https. Verified against both on this machine,
// and against a closed port, which answers in ~10ms rather than hanging.
export function portSpeaksTls(port, exec = execFileSync) {
  try {
    exec("curl", ["-sk", "--max-time", "2", "-o", "/dev/null", `https://127.0.0.1:${port}/`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function connectionUrls({
  ports,
  lanAddress,
  webScheme = mobileCertsExist() ? "https" : "http",
  apiScheme = "http",
}) {
  return {
    webLocal: `${webScheme}://localhost:${ports.vite}`,
    webLan: lanAddress ? `${webScheme}://${lanAddress}:${ports.vite}` : null,
    expoLan: lanAddress ? `exp://${lanAddress}:${ports.metro}` : null,
    expoEmulator: `exp://127.0.0.1:${ports.metro}`,
    apiLocal: `${apiScheme}://localhost:${ports.backend}`,
    apiLan: lanAddress ? `${apiScheme}://${lanAddress}:${ports.backend}` : null,
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

// A stack's true root is ABOVE its listener, never below it. Measured on
// this machine: the backend listener 77852 is a leaf whose `node`,
// `npm run dev`, `sh` and `npm run backend` supervisors are all its
// ancestors, and 76% of the stack's RSS lives in them. Walking only
// downward from the listener (and from the recorded pid, which
// dev-emulator.mjs leaves dead) reported three leaf processes and missed
// the rest.
//
// THE STOP CONDITION IS THE DANGEROUS PART. Measured on this machine, the
// vite chain continues upward into `codex` (97 MB) and then `ChatGPT`
// (277 MB) — the agent that happened to launch the dev server. An
// unbounded climb bills a third of a gigabyte of unrelated editor to this
// stack. So an ancestor is only crossed when BOTH hold:
//   - its cwd is at or inside the worktree (processCwd(41061) is "/" for
//     codex here, but an agent started from the repo root would pass this
//     alone, which is why it is not the only condition), and
//   - its comm names a node-toolchain supervisor. The whole real chain is
//     node/npm/sh; `codex` and `ChatGPT` are not.
// pid 1 (and an unknown or already-visited parent) always terminates it.
const SUPERVISOR_COMMS = new Set(["node", "npm", "npx", "sh", "bash", "zsh", "tsx"]);

// macOS `ps -o comm` prints npm as its full argv line ("npm run backend")
// and everything else as a path that may itself contain spaces
// ("/Applications/Some App.app/Contents/MacOS/Some App"), so the name is
// the first whitespace-delimited word of the path's last segment.
function commName(comm) {
  return comm.slice(comm.lastIndexOf("/") + 1).split(/\s+/)[0];
}

function isStackAncestor(row, worktree, cwdForPid) {
  if (!SUPERVISOR_COMMS.has(commName(row.comm))) return false;
  const cwd = cwdForPid(row.pid);
  if (typeof cwd !== "string" || cwd.length === 0) return false;
  return cwd === worktree || cwd.startsWith(`${worktree}/`);
}

const SHELL_COMMS = new Set(["sh", "bash", "zsh"]);

// A shell is crossed only when its OWN parent is another supervisor —
// the `npm run backend` -> sh -> `npm run dev` chain npm itself creates.
// Without this, an interactive shell is crossed too: it prints comm
// "/bin/zsh", which passes the toolchain test, and its cwd is the
// worktree you started the server from, which passes the cwd test. Its
// parent is a terminal, so climbing through it bills every sibling
// started in that same shell to this stack — measured at 1028 MB for a
// ~100 MB stack. (A login shell prints "-zsh" and is already rejected by
// name; a non-login one is not, so this is the check that holds.) An
// unknown grandparent is not crossed either: under-reporting is the safe
// direction.
function crossesShell(parent, byPid) {
  if (!SHELL_COMMS.has(commName(parent.comm))) return true;
  const grandparent = byPid.get(parent.ppid);
  return grandparent !== undefined && SUPERVISOR_COMMS.has(commName(grandparent.comm));
}

export function climbToStackRoot(pid, { byPid, worktree, cwdForPid }) {
  let current = byPid.get(pid);
  if (current === undefined) return pid;
  const seen = new Set([current.pid]);
  while (current.ppid > 1) {
    const parent = byPid.get(current.ppid);
    if (parent === undefined || seen.has(parent.pid)) break;
    if (!isStackAncestor(parent, worktree, cwdForPid)) break;
    if (!crossesShell(parent, byPid)) break;
    seen.add(parent.pid);
    current = parent;
  }
  return current.pid;
}

export function buildStacks({ registry, rows, listeners, lanAddress, cwdForPid = processCwd, webScheme, speaksTls = portSpeaksTls }) {
  const index = indexProcessTable(rows);
  const { byPid } = index;
  // processCwd shells out to lsof, and the climb asks about the same
  // ancestor once per listener, so the answers are memoised per call.
  const cwdCache = new Map();
  const cwdOnce = (pid) => {
    if (!cwdCache.has(pid)) cwdCache.set(pid, cwdForPid(pid));
    return cwdCache.get(pid);
  };
  return Object.keys(registry.slots)
    .map(Number)
    .sort((a, b) => a - b)
    .map((slot) => {
      const entry = registry.slots[String(slot)];
      const ports = portsForSlot(slot);
      const portAudit = auditPorts({ ports, listeners, worktree: entry.worktree, cwdForPid: cwdOnce });

      const backendListening = (listeners[ports.backend] ?? []).length > 0;

      const roleByPid = new Map(portAudit.flatMap(({ role, pids }) => pids.map((pid) => [pid, role])));
      // Every pid the slot owns: the recorded claimer's subtree, plus the
      // subtree of the highest ancestor of each listener still
      // attributable to this worktree. They are usually disjoint — the
      // claimer exits and the servers it spawned are reparented to
      // launchd — so every root is walked and the union deduped.
      const roots = [
        entry.pid,
        ...portAudit.flatMap(({ pids }) =>
          pids.map((pid) => climbToStackRoot(pid, { byPid, worktree: entry.worktree, cwdForPid: cwdOnce })),
        ),
      ];
      const owned = new Map();
      for (const root of roots) {
        for (const pid of sumSubtree(root, rows, index).pids) owned.set(pid, byPid.get(pid));
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
        urls: connectionUrls({
          ports,
          lanAddress,
          ...(webScheme === undefined ? {} : { webScheme }),
          // Only probed when something is actually listening: a handshake
          // against a free port tells us nothing, and every slot in the
          // registry would otherwise cost a curl.
          apiScheme: backendListening && speaksTls(ports.backend) ? "https" : "http",
        }),
      };
    });
}

export const DEVICE_LEASE_WARN_MS = 30 * 60 * 1000;

export function statusWarnings({ host, stacks, devices, orphans, limits = DEFAULT_LIMITS }) {
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
  const warnings = statusWarnings({ host, stacks, devices, orphans, limits });
  return { host, stacks, devices, orphans, limits, warnings };
}
