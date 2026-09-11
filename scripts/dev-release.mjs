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

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { portsForSlot, readRegistry, registryPath, releaseDevice, releaseSlot, slotForWorktree } from "./devRegistry.mjs";
import { teardownPort } from "./devTeardown.mjs";
import { worktreeIdentity } from "./devHost.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const path = registryPath(repoRoot);
const { worktree, branch } = worktreeIdentity(repoRoot);

function log(message) {
  console.log(`[dev-release] ${message}`);
}

// Read the registry BEFORE releasing anything: releaseSlot deletes this
// worktree's entry, and its ports can only be derived from the slot
// number (portsForSlot) while that entry still exists.
const registry = readRegistry(path);
const slot = slotForWorktree(registry, worktree);

if (slot === undefined) {
  log(`${branch} holds no slot — nothing to tear down.`);
} else {
  const ports = portsForSlot(Number(slot));
  log(`Slot ${slot} (${branch}) — tearing down backend :${ports.backend} and Metro :${ports.metro}...`);
  for (const [label, port] of [["backend", ports.backend], ["Metro", ports.metro]]) {
    const { killed, skipped } = teardownPort(port, worktree);
    if (killed.length > 0) log(`  ${label} :${port} — killed pid(s) ${killed.join(", ")}.`);
    else log(`  ${label} :${port} — nothing listening.`);
    for (const { pid, reason } of skipped) {
      console.warn(`[dev-release] WARNING: left pid ${pid} on ${label} :${port} running — ${reason}.`);
    }
  }
}

// adb reverse tunnel cleanup. The registry records only the AVD name and
// pid for a device lease (see devRegistry.mjs's EMPTY_REGISTRY.devices
// shape) — never the adb serial that lease resolved to, and
// dev-emulator.mjs's own getEmulatorSerial() doesn't disambiguate between
// two concurrently-booted emulators either (it returns the first
// "emulator-\d+ device" line adb reports, full stop). Reliably mapping
// "the AVD this worktree leased" to "the one serial holding its tunnels"
// would need new, unverified adb-console interaction (e.g. `adb -s
// <serial> emu avd name` per candidate serial) that nothing here has
// exercised — and a wrong guess removes another worktree's tunnels,
// exactly the class of mistake this whole design exists to prevent. So
// this skips tunnel cleanup rather than risk it: safer to leave a stale
// `adb reverse` entry (harmless once nothing is listening behind it) than
// to `--remove` the wrong worktree's.
const hadDeviceLease = Object.values(registry.devices).some((lease) => lease?.worktree === worktree);
if (hadDeviceLease) {
  console.warn(
    "[dev-release] WARNING: a device lease is held, but its adb serial isn't recorded in the registry — " +
      "skipping adb reverse tunnel cleanup. Remove them by hand if needed: " +
      "`adb -s <serial> reverse --remove tcp:<port>` for this worktree's own backend/Metro ports only " +
      "(never `--remove-all`, which would break another worktree's device session).",
  );
}

releaseDevice({ path, worktree });
releaseSlot({ path, worktree });
log(`released the slot and any emulator held by ${branch}.`);
