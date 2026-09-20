// Where this worktree's Metro keeps its bundler cache.
//
// @expo/metro-config hardcodes the cache root to `os.tmpdir()/metro-cache`,
// which is one directory for the whole machine — so every worktree's Metro
// shares it. Measured on this machine, 2026-09-20: with three worktrees'
// Metros running, an edit in one worktree never reached the emulator. Metro
// served the edited source for a plain JS bundle and the OTHER checkout's
// compiled output for the same request with `transform.bytecode=1` — which is
// the one Expo Go always sends. The app therefore ran code from a different
// branch, through `pm clear`, cold starts, a Metro restart and a reboot, with
// nothing anywhere saying so. `expo start --clear` fixed it, which is what
// identifies the cache as the thing at fault.
//
// Overriding TMPDIR for the Metro child, rather than its cacheStores, keeps
// Expo's own store class and its binary format — the point here is only to
// stop two worktrees writing to one directory, not to reimplement the cache.
// Every other temp file that Metro child writes lands here too; that is the
// cost, and it is per-worktree and swept by the OS like any other tmpdir.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keyed on the worktree's path, not its slot: slots are handed back and
// reused, and a cache inherited from whichever worktree held the slot last is
// the same collision this exists to prevent.
export function metroCacheDir(worktree, { root = tmpdir() } = {}) {
  const digest = createHash("sha256").update(worktree).digest("hex").slice(0, 12);
  return join(root, `scripta-metro-${digest}`);
}

/** The env a Metro child needs to keep its cache to itself. Creates the
 *  directory, because os.tmpdir() readers assume theirs already exists. */
export function metroCacheEnv(worktree, { root = tmpdir(), mkdir = mkdirSync } = {}) {
  const dir = metroCacheDir(worktree, { root });
  mkdir(dir, { recursive: true });
  return { TMPDIR: dir };
}
