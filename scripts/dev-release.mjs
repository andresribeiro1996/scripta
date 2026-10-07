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
import { registryPath } from "./devRegistry.mjs";
import { releaseWorktree } from "./devTeardown.mjs";
import { worktreeIdentity } from "./devHost.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const path = registryPath(repoRoot);
const { worktree, branch } = worktreeIdentity(repoRoot);

releaseWorktree({ path, worktree, branch });
