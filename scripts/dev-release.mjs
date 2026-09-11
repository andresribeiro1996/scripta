// Hand back this worktree's slot and any emulator it holds. The counterpart
// to the claim dev-emulator.mjs makes at boot.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registryPath, releaseDevice, releaseSlot } from "./devRegistry.mjs";
import { worktreeIdentity } from "./devHost.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const path = registryPath(repoRoot);
const { worktree, branch } = worktreeIdentity(repoRoot);

releaseDevice({ path, worktree });
releaseSlot({ path, worktree });
console.log(`[dev-release] released the slot and any emulator held by ${branch}.`);
