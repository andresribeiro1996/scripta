// One slot per worktree. Every dev port this repo binds derives from it,
// so two worktrees can never land on the same number — see
// docs/superpowers/specs/2026-09-11-worktree-port-lanes-design.md.

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
