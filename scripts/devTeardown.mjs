// Tears down this worktree's own backend + Metro on `npm run dev:release`.
// The counterpart to the process-spawning half of dev-emulator.mjs — see
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md's
// "Release" section: "On teardown: kill this worktree's processes, remove
// the slot entry, release any held device." dev-release.mjs already did
// the latter two; this fills in the first.
//
// WHY THE KILL IS PORT-DERIVED, NEVER PATTERN-MATCHED:
// A previous session ran `pkill -f "tsx watch scripts/three-users.mjs"` to
// tidy up and killed the fixture servers of EVERY worktree at once, because
// the command line is identical across worktrees and nothing in it scopes
// to one checkout. Do not "simplify" this back to a pkill/killall pattern
// match — ever. Instead: read this worktree's slot from the registry
// BEFORE releasing it, derive its three ports with portsForSlot, find
// whatever PID is actually LISTENing on each of the backend/Metro ports
// (lsof, by port — never by name), and only then confirm each PID really
// belongs to this worktree before touching it (see pidsToTeardown below).
// A PID sitting on a port this worktree thinks it owns is not proof it's
// this worktree's process — another worktree's server, or an unrelated
// app, may hold it.

import { execFileSync, spawnSync } from "node:child_process";
import { portsForSlot, readRegistry, releaseDevice, releaseSlot, slotForWorktree, staleSlots } from "./devRegistry.mjs";

// Blocks synchronously for `ms` without spawning a process — the same
// Atomics.wait idiom scripts/devRegistry.mjs's sleepSync uses, for the
// same reason (no `sleep` child, no portability concern). Used below to
// poll killPid's grace period instead of busy-waiting the CPU.
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// dev-emulator.mjs spawns both the backend and Metro with `cwd: repoRoot`
// (spawnDetached's `cwd` option, see ensureBackendRunning/ensureMetroRunning),
// so a process's own working directory is an exact, load-bearing signal of
// which worktree started it — not a heuristic bolted on after the fact.
// That's the check used here, over inspecting the command line: cwd is
// resolvable with a single `lsof -d cwd` call and cannot be confused by
// two worktrees running the identical `npm run backend` / `expo start`
// command line, which is exactly the ambiguity that made the pkill
// incident possible in the first place.
export function processCwd(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-n", "-Fn"], {
      encoding: "utf8",
    });
    const nameLine = output.split("\n").find((line) => line.startsWith("n"));
    return nameLine ? nameLine.slice(1) : undefined;
  } catch {
    // Process already gone, lsof missing, or no permission to inspect it —
    // any of these must read as "cwd could not be resolved", never throw.
    return undefined;
  }
}

// PIDs of whatever is LISTENing on `port` right now, resolved fresh from
// the kernel rather than trusted from the registry (which only ever
// records the claiming pid dev-emulator.mjs itself exits within seconds —
// see devRegistry.mjs's isSlotLive comment).
export function pidsListeningOn(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(Number);
  } catch (error) {
    // lsof exits 1 with empty output when nothing is listening on the
    // port — the expected, common case, not a failure to surface.
    if (error.status === 1) return [];
    throw error;
  }
}

// Pure decision function — the only part of this module that is
// unit-testable without touching real processes. Given process candidates
// (each `{ pid, cwd }`, cwd possibly undefined if unresolvable) and this
// worktree's own absolute path, decide which PIDs are safe to kill.
//
// A candidate is killed only when its cwd resolves to a path at or inside
// this worktree. Everything else — a cwd belonging to a different
// worktree, or a cwd that could not be resolved at all — is skipped.
// Skipping is always the safe default here (see the pkill incident in
// this module's header comment): a false negative just leaves a process
// running for the caller to notice and clean up by hand; a false positive
// kills someone else's stack out from under them.
// Every port a worktree's stack binds, in the order dev-release tears them
// down. All THREE belong here, not just the two the emulator workflow
// starts: `npm run frontend` binds the slot's web port too, and an orphaned
// Vite is the same failure as an orphaned backend — it keeps the port bound,
// so isSlotLive reads the slot as in use, while the registry says it is
// free. That mismatch is exactly what the release step exists to prevent.
// (adb reverse tunnels are a separate list — only backend and Metro are
// ever tunnelled to a device; the browser reaches Vite directly.)
export function teardownTargets(ports) {
  return [
    ["backend", ports.backend],
    ["web", ports.vite],
    ["Metro", ports.metro],
  ];
}

export function pidsToTeardown(candidates, worktreePath) {
  const toKill = [];
  const toSkip = [];
  for (const { pid, cwd } of candidates) {
    if (typeof cwd !== "string" || cwd.length === 0) {
      toSkip.push({ pid, reason: "cwd could not be resolved" });
      continue;
    }
    const inside = cwd === worktreePath || cwd.startsWith(`${worktreePath}/`);
    if (inside) {
      toKill.push(pid);
    } else {
      toSkip.push({ pid, reason: `cwd ${cwd} is outside ${worktreePath}` });
    }
  }
  return { toKill, toSkip };
}

export function processGroup(pid) {
  try {
    const pgid = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim());
    return Number.isInteger(pgid) && pgid > 1 ? pgid : undefined;
  } catch (error) {
    if (error.status === 1) return undefined;
    throw error;
  }
}

// dev-emulator.mjs spawns the backend and Metro detached, so each stack is
// its own process group led by the `npm run …` it started, and the listener
// is only the last link of that chain (npm → sh → npm → tsx watch → server).
// Killing just the listener leaves the supervisors above it alive. The whole
// group is killed only when its leader is still alive, sits at or inside this
// worktree (same cwd rule as pidsToTeardown) and is not our own group.
export function shouldKillGroup({ pgid, leaderCwd, ownPgid }, worktreePath) {
  if (pgid === undefined || pgid === ownPgid) return false;
  return pidsToTeardown([{ pid: pgid, cwd: leaderCwd }], worktreePath).toKill.length === 1;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// SIGTERM first, give it a moment, SIGKILL only what survives — never the
// other way around, so a server gets its normal shutdown path (closing
// its SQLite handle, flushing logs) when it can take it.
function killPid(pid, { graceMs = 2000 } = {}) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return; // already gone
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && isAlive(pid)) {
    sleepSync(100);
  }
  if (isAlive(pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone between the check and the kill
    }
  }
}

// Finds whatever is listening on `port`, keeps only PIDs verified to
// belong to `worktreePath`, kills those (with their whole process group when
// shouldKillGroup allows), and reports both what was killed and what was
// skipped (with why) so the caller can log it.
export function teardownPort(port, worktreePath) {
  const pids = pidsListeningOn(port);
  const { toKill, toSkip } = pidsToTeardown(
    pids.map((pid) => ({ pid, cwd: processCwd(pid) })),
    worktreePath,
  );
  const ownPgid = processGroup(process.pid);
  const groups = [];
  for (const pid of toKill) {
    const pgid = processGroup(pid);
    if (shouldKillGroup({ pgid, leaderCwd: pgid === undefined ? undefined : processCwd(pgid), ownPgid }, worktreePath)) {
      killPid(-pgid);
      groups.push(pgid);
    } else {
      killPid(pid);
    }
  }
  return { killed: toKill, groups, skipped: toSkip };
}

function log(message) {
  console.log(`[dev-release] ${message}`);
}

export function releaseWorktree({ path, worktree, branch }) {
  // Read the registry BEFORE releasing anything: releaseSlot deletes this
  // worktree's entry, and its ports (needed for both process teardown below
  // and adb reverse tunnel cleanup further down) can only be derived from
  // the slot number (portsForSlot) while that entry still exists. Same for
  // the device lease's recorded serial — releaseDevice clears it.
  const registry = readRegistry(path);
  const slot = slotForWorktree(registry, worktree);
  const ports = slot === undefined ? undefined : portsForSlot(Number(slot));

  if (slot === undefined) {
    log(`${branch} holds no slot — nothing to tear down.`);
  } else {
    log(`Slot ${slot} (${branch}) — tearing down backend :${ports.backend}, web :${ports.vite} and Metro :${ports.metro}...`);
    for (const [label, port] of teardownTargets(ports)) {
      const { killed, groups, skipped } = teardownPort(port, worktree);
      if (killed.length > 0) {
        const groupNote = groups.length > 0 ? `, process group(s) ${groups.join(", ")}` : "";
        log(`  ${label} :${port} — killed pid(s) ${killed.join(", ")}${groupNote}.`);
      } else {
        log(`  ${label} :${port} — nothing listening.`);
      }
      for (const { pid, reason } of skipped) {
        console.warn(`[dev-release] WARNING: left pid ${pid} on ${label} :${port} running — ${reason}.`);
      }
    }
  }

  // adb reverse tunnel cleanup. dev-emulator.mjs's ensureAvdBooted now
  // resolves the serial by AVD name (scripts/devRegistry.mjs's
  // recordDeviceSerial stores it on the lease), so — when a serial was
  // actually recorded — this removes exactly this worktree's own two
  // tunnels by port, on that one serial, and NEVER `--remove-all` (which
  // would tear down a different worktree's device session sharing the same
  // machine). An older registry, or a lease taken before this recording
  // existed, has no serial on it: this degrades to the previous warning and
  // skips cleanup rather than guess which serial to touch.
  const deviceEntry = Object.entries(registry.devices).find(([, lease]) => lease?.worktree === worktree);
  if (deviceEntry) {
    const [avd, lease] = deviceEntry;
    if (lease.serial && ports) {
      for (const [label, port] of [["backend", ports.backend], ["Metro", ports.metro]]) {
        const result = spawnSync("adb", ["-s", lease.serial, "reverse", "--remove", `tcp:${port}`], { encoding: "utf8" });
        if (result.status === 0) log(`  removed adb reverse tcp:${port} (${label}) on ${lease.serial} (${avd}).`);
        else {
          console.warn(
            `[dev-release] WARNING: could not remove adb reverse tcp:${port} on ${lease.serial}: ` +
              `${(result.stderr || result.stdout || "").trim()}`,
          );
        }
      }
    } else {
      console.warn(
        "[dev-release] WARNING: a device lease is held, but its adb serial isn't recorded in the registry — " +
          "skipping adb reverse tunnel cleanup. Remove them by hand if needed: " +
          "`adb -s <serial> reverse --remove tcp:<port>` for this worktree's own backend/Metro ports only " +
          "(never `--remove-all`, which would break another worktree's device session).",
      );
    }
  }

  releaseDevice({ path, worktree });
  releaseSlot({ path, worktree });
  log(`released the slot and any emulator held by ${branch}.`);
}

export function reapStaleSlots({ path, worktree, now = Date.now() }) {
  for (const { slot, entry, ageMs } of staleSlots(readRegistry(path), now, worktree)) {
    const age = Number.isFinite(ageMs) ? `${(ageMs / 3_600_000).toFixed(1)}h` : "unknown age";
    log(`slot ${slot} (${entry.branch}, ${entry.worktree}) was claimed ${age} ago — releasing it.`);
    try {
      releaseWorktree({ path, worktree: entry.worktree, branch: entry.branch });
    } catch (error) {
      console.warn(`[dev-release] WARNING: could not release slot ${slot} (${entry.branch}): ${error.message}`);
    }
  }
}
