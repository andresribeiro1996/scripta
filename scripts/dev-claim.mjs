#!/usr/bin/env node
// Claims this worktree's port-lane slot without booting anything else —
// the piece `npm run backend` and `npm run frontend` run ahead of the
// real dev servers (see root package.json) so a pure web+backend
// workflow gets the same port isolation the emulator script always had.
// Also runnable by hand: `npm run dev:claim`. Idempotent — re-running it
// from the same worktree reuses the slot it already holds and just
// reprints it.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { claimThisWorktreeSlot } from "./devClaim.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const lanRequested = process.argv.includes("--lan");

async function main() {
  const { slot, branch, ports } = await claimThisWorktreeSlot({
    repoRoot,
    transport: lanRequested ? "lan" : "loopback",
    lanAddress: lanRequested ? pickLanAddress() : undefined,
  });
  console.log(
    `[dev-claim] Slot ${slot} (${branch}) — backend :${ports.backend}, web :${ports.vite}, Metro :${ports.metro}.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
