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
// safe to re-run any time" — so this only counts OTHER worktrees' live
// slots, and only applies the gate at all when this worktree is about to
// be handed a genuinely NEW slot: claimSlot short-circuits to reusing its
// own slot before ever consulting isSlotLive, so re-claiming adds no new
// stack and must never be counted against, or blocked by, other
// worktrees' stacks.
export function assertResourceGate({ registry, worktree, isPortFree, limits = DEFAULT_LIMITS, host }) {
  if (slotForWorktree(registry, worktree) !== undefined) return;
  const stackCount = Object.entries(registry.slots).filter(([slot, entry]) => isSlotLive(slot, entry, isPortFree)).length;
  assertResourcesAvailable({ stackCount, limits, host });
}

// Claims this worktree's slot (or reuses the one it already holds) and
// writes the six derived env values (scripts/devSlotEnv.mjs) for it.
// Returns { slot, ports, branch, worktree }. Idempotent: calling this
// twice from the same worktree returns the same slot both times.
export async function claimThisWorktreeSlot({ repoRoot, transport = "loopback", lanAddress } = {}) {
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
