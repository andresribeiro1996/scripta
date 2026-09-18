// The shared "claim this worktree's slot" step: the resource gate, the
// port probe, the actual registry claim, and writing the derived env
// values. Extracted out of dev-emulator.mjs so every workflow that binds
// a port — not just the emulator script — runs it: see Finding C2b in
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md. Before
// this, `npm run frontend` / `npm run backend` never claimed a slot at
// all, so a worktree doing pure web+backend work got no isolation unless
// someone happened to run the AVD script first just to populate the
// .env files.

import { join } from "node:path";
import { ensureBackendEnv } from "./dev-account.mjs";
import { assertResourcesAvailable, DEFAULT_LIMITS, probePorts, readHost, worktreeIdentity } from "./devHost.mjs";
import { claimSlot, isSlotLive, portsForSlot, readRegistry, registryPath, slotForWorktree } from "./devRegistry.mjs";
import { applySlotEnv } from "./devSlotEnv.mjs";

// The 4-stack gate must never block a worktree re-running its OWN
// already-live stack — dev-emulator.mjs documents itself as "Idempotent:
// safe to re-run any time" — so the STACK-COUNT check excludes this
// worktree's own slot, but ONLY when that slot is actually live
// (isSlotLive, not mere presence in registry.slots): a stale record from
// a worktree that crashed without `npm run dev:release` — dead pid, free
// ports — is not a live re-claim, and must still count toward the limit
// like any other slot, since the claim about to follow spawns genuinely
// new, memory-consuming processes. Memory and load-average are NEVER
// excluded, on any path: re-claiming a live slot adds no new stack, but
// it does nothing to prove the machine has room, and a host genuinely
// low on memory must still refuse — that's the entire point of the gate.
export function assertResourceGate({ registry, worktree, isPortFree, limits = DEFAULT_LIMITS, host }) {
  const ownSlot = slotForWorktree(registry, worktree);
  const ownSlotIsLiveReclaim = ownSlot !== undefined && isSlotLive(ownSlot, registry.slots[ownSlot], isPortFree);
  const stackCount = Object.entries(registry.slots).filter(([slot, entry]) => {
    if (ownSlotIsLiveReclaim && slot === ownSlot) return false;
    return isSlotLive(slot, entry, isPortFree);
  }).length;
  assertResourcesAvailable({ stackCount, limits, host });
}

// Claims this worktree's slot (or reuses the one it already holds) and
// writes the six derived env values (scripts/devSlotEnv.mjs) for it.
// Returns { slot, ports, branch, worktree }. Idempotent: calling this
// twice from the same worktree returns the same slot both times.
export async function claimThisWorktreeSlot({ repoRoot, transport = "loopback", lanAddress, requestedSlot } = {}) {
  const path = registryPath(repoRoot);
  const { worktree, branch, isPrimary } = worktreeIdentity(repoRoot);

  // Probed once, up front, so the resource gate and the claim itself
  // (isSlotLive / claimSlot) judge port occupancy from the same
  // snapshot rather than two probes racing each other.
  const candidatePorts = Array.from({ length: 16 }, (_, slot) => Object.values(portsForSlot(slot))).flat();
  const freeByPort = await probePorts(candidatePorts);
  const isPortFree = (port) => freeByPort[port] === true;

  const registry = readRegistry(path);
  assertResourceGate({ registry, worktree, isPortFree, host: readHost() });

  const { slot, ports } = claimSlot({
    path,
    worktree,
    branch,
    pid: process.pid,
    session: process.env.CLAUDE_SESSION ?? null,
    isPrimary,
    isPortFree,
    requestedSlot,
  });

  // Must run BEFORE applySlotEnv: on a fresh worktree there is no
  // backend/.env yet, and applySlotEnv's upsertEnvLine would otherwise be
  // what creates it — with only PORT/FRONTEND_URL/VITE_PORT — which then
  // makes dev-account.mjs's own ensureBackendEnv() see an existing file
  // and skip generating JWT secrets. Calling it here first means the
  // slot values land on top of a complete .env instead of standing in
  // for one. A no-op when backend/.env already exists.
  ensureBackendEnv(join(repoRoot, "backend"));

  applySlotEnv({ repoRoot, ports, transport, lanAddress });

  return { slot, ports, branch, worktree };
}
