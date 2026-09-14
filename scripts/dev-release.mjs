// Hand back this worktree's slot, kill the processes it started, and
// release any emulator it holds. The counterpart to the claim
// dev-emulator.mjs makes at boot — see the "Release" section of
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md:
// "On teardown: kill this worktree's processes, remove the slot entry,
// release any held device." Removing the slot entry and releasing the
// device already happened here; this fills in the first part, which
// used to be a no-op — proven by direct observation: after a real
// dev-emulator.mjs boot on slot 1, running this left `slots: {}` but the
// backend was still listening on :3100 and Metro on :8181, both orphaned
// and unrecorded.
//
// Killing is port-derived, never pattern-matched by process name — see
// scripts/devTeardown.mjs's header comment for why: a previous session's
// `pkill -f "tsx watch scripts/three-users.mjs"` killed every worktree's
// fixture server at once, because the command line is identical across
// worktrees. This resolves PIDs from THIS worktree's own slot ports only,
// and verifies each PID's cwd before touching it.

import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { portsForSlot, readRegistry, registryPath, releaseDevice, releaseSlot, slotForWorktree } from "./devRegistry.mjs";
import { teardownPort, teardownTargets } from "./devTeardown.mjs";
import { worktreeIdentity } from "./devHost.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const path = registryPath(repoRoot);
const { worktree, branch } = worktreeIdentity(repoRoot);

function log(message) {
  console.log(`[dev-release] ${message}`);
}

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
    const { killed, skipped } = teardownPort(port, worktree);
    if (killed.length > 0) log(`  ${label} :${port} — killed pid(s) ${killed.join(", ")}.`);
    else log(`  ${label} :${port} — nothing listening.`);
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
