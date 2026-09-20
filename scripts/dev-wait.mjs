#!/usr/bin/env node
// Waits for text to appear on the emulator this worktree leases, then exits.
// Replaces the `adb shell sleep 45` that every step of driving the app used
// to start with — see devWait.mjs for why a constant is the wrong tool.
//
//   node scripts/dev-wait.mjs "Sign in"
//   node scripts/dev-wait.mjs "Sign in" --timeout 120
//   node scripts/dev-wait.mjs "Loading" --absent
//
// Exits 0 when the condition holds, 1 when it times out — so it chains:
//   node scripts/dev-wait.mjs "Sign in" && adb -s <serial> exec-out screencap -p > screen.png
//
// Scoped to this worktree's own lease, like dev-tunnels.mjs, so it can never
// poll a device another worktree is driving.

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { worktreeIdentity } from "./devHost.mjs";
import { deviceHolders, readRegistry, registryPath } from "./devRegistry.mjs";
import { waitForText } from "./devWait.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function log(message) {
  console.log(`[dev-wait] ${message}`);
}

export function parseArgs(argv) {
  const text = argv.find((arg) => !arg.startsWith("--"));
  const timeoutFlag = argv.indexOf("--timeout");
  const seconds = timeoutFlag === -1 ? 60 : Number(argv[timeoutFlag + 1]);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--timeout takes a number of seconds.");
  return { text, absent: argv.includes("--absent"), timeoutMs: seconds * 1000 };
}

async function main() {
  const { text, absent, timeoutMs } = parseArgs(process.argv.slice(2));
  if (!text) {
    log('needs the text to wait for, e.g. `node scripts/dev-wait.mjs "Sign in"`.');
    process.exitCode = 1;
    return;
  }

  const { worktree, branch } = worktreeIdentity(repoRoot);
  const lease = deviceHolders(readRegistry(registryPath(repoRoot))).find((holder) => holder.worktree === worktree);
  if (!lease?.serial) {
    log(`${branch} holds no emulator — run \`node scripts/dev-emulator.mjs\` first.`);
    process.exitCode = 1;
    return;
  }

  const { found, elapsedMs, screen } = await waitForText(lease.serial, text, { absent, timeoutMs });
  const seconds = (elapsedMs / 1000).toFixed(1);
  if (found) {
    log(`"${text}" ${absent ? "gone" : "on screen"} after ${seconds}s.`);
    return;
  }
  log(`timed out after ${seconds}s waiting for "${text}" to ${absent ? "go away" : "appear"}.`);
  // The screen it gave up on is the whole diagnosis: a splash means still
  // loading, the wrong route means the app went somewhere else, and nothing
  // at all means the app is not drawing.
  log(screen.length ? `screen showed: ${screen.slice(0, 12).join(" · ")}` : "screen showed no text at all.");
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`[dev-wait] failed: ${error.message}`);
  process.exitCode = 1;
}
