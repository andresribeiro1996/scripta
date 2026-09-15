#!/usr/bin/env node
// Puts this worktree's adb reverse tunnels back on the emulator it
// leases. They are dropped by `adb root` (which restarts adbd), by
// unplugging or rebooting the device, and by the emulator being killed
// and rebooted under the same lease — and nothing notices until the app
// fails to reach Metro or the API minutes later. `npm run dev:status`
// reports when they are gone; this is what it tells you to run.
//
// Scoped to this worktree's own lease and its own slot-derived ports, so
// it can never map another worktree's ports onto a device it does not
// hold.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { deviceHolders, portsForSlot, readRegistry, registryPath, slotForWorktree } from "./devRegistry.mjs";
import { applyTunnel, readReverseList, TUNNELLED_ROLES } from "./devTunnels.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function log(message) {
  console.log(`[dev-tunnels] ${message}`);
}

function main() {
  const { worktree, branch } = worktreeIdentity(repoRoot);
  const registry = readRegistry(registryPath(repoRoot));

  const slot = slotForWorktree(registry, worktree);
  if (slot === undefined) {
    log(`${branch} holds no slot — run \`npm run dev:claim\` first.`);
    process.exitCode = 1;
    return;
  }

  const lease = deviceHolders(registry).find((holder) => holder.worktree === worktree);
  if (lease === undefined) {
    log(`${branch} holds no emulator — nothing to tunnel.`);
    process.exitCode = 1;
    return;
  }
  if (!lease.serial) {
    log(`${lease.avd} is leased by ${branch} but its lease records no adb serial — re-run \`node scripts/dev-emulator.mjs\`.`);
    process.exitCode = 1;
    return;
  }

  const ports = portsForSlot(Number(slot));
  const before = readReverseList(lease.serial);
  for (const role of TUNNELLED_ROLES) {
    const port = ports[role];
    applyTunnel(lease.serial, port);
    log(`${role} :${port} — ${before.includes(port) ? "already up, refreshed" : "restored"}.`);
  }
  log(`${lease.avd} (${lease.serial}) is tunnelled for slot ${slot} (${branch}).`);
}

try {
  main();
} catch (error) {
  console.error(`[dev-tunnels] failed: ${error.message}`);
  process.exitCode = 1;
}
