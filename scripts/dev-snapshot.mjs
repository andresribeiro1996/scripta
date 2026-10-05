#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { deviceHolders, readRegistry, registryPath } from "./devRegistry.mjs";
import { parseSnapshotArgs, takeSnapshot } from "./devSnapshot.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

try {
  const { name, outDir } = parseSnapshotArgs(process.argv.slice(2));
  const { worktree, branch } = worktreeIdentity(repoRoot);
  const lease = deviceHolders(readRegistry(registryPath(repoRoot))).find((holder) => holder.worktree === worktree);
  if (!lease?.serial) throw new Error(`${branch} holds no emulator — run \`node scripts/dev-emulator.mjs\` first.`);
  console.log(takeSnapshot(lease.serial, name, resolve(outDir)));
} catch (error) {
  console.error(`[dev-snapshot] ${error.message}`);
  process.exitCode = 1;
}
