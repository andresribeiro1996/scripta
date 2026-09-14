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

import { execFileSync } from "node:child_process";

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
// belong to `worktreePath`, kills those, and reports both what was killed
// and what was skipped (with why) so the caller can log it.
export function teardownPort(port, worktreePath) {
  const pids = pidsListeningOn(port);
  const { toKill, toSkip } = pidsToTeardown(
    pids.map((pid) => ({ pid, cwd: processCwd(pid) })),
    worktreePath,
  );
  for (const pid of toKill) killPid(pid);
  return { killed: toKill, skipped: toSkip };
}
