#!/usr/bin/env node
// One command to test the mobile app on a physical phone over LAN,
// signed in with no password — the counterpart to dev-emulator.mjs for
// a device this can't drive over adb. See mobile/README.md's "Testing
// on a physical phone" section for the manual version this replaces.
//
// Idempotent: safe to re-run any time. Rebuilds @scripta/shared only if
// this worktree hasn't yet, reuses the backend/Metro already running on
// this worktree's slot if either is up, and by default leaves existing
// dev-account/fixture-user progress alone. Pass --reset to wipe
// backend/data/dev/ and reseed everything from scratch.
//
//   0. Claim this worktree's port slot with LAN transport
//      (scripts/devClaim.mjs) — this is what writes mobile/.env.local's
//      EXPO_PUBLIC_API_URL to this machine's LAN address rather than
//      127.0.0.1, so a phone on the same Wi-Fi can actually reach it.
//   1. Build @scripta/shared if this worktree hasn't yet.
//   2. --reset only: wipe backend/data/dev/.
//   3. Seed the dev account + fixture library (scripts/dev-account.mjs)
//      and fixture_alice/bob/charlie, all into backend/data/dev/.
//   4. Start the backend AGAINST THAT SAME DIRECTORY, in plain-http LAN
//      mode: PUBLIC_API_URL (so cover/gallery image urls resolve on the
//      phone) and ALLOW_LAN_ORIGINS (CORS) set directly, using the
//      exact LAN address step 0 already picked rather than a second
//      independent detection that could disagree with it. Deliberately
//      NOT `npm run dev:mobile` (backend/scripts/dev-mobile.mjs) — that
//      script also switches to https whenever the PWA's mkcert certs
//      happen to exist, which Expo Go does not trust the way a browser
//      does; see ensureBackendRunning's own comment below. This is also
//      the step that plain `npm run backend` skips entirely: it seeds
//      and serves backend/data/*.sqlite instead, a different database
//      than dev-account.mjs just wrote to, and the app comes up saying
//      it can't load your account. See the dev-account-fixture-login
//      memory — this script exists so that trap can't recur.
//   5. Start Metro advertising on the LAN — no --localhost (that's the
//      emulator-only path, which reaches Metro through an adb reverse
//      tunnel instead and would leave a physical phone unable to
//      connect at all).
//   6. Broadcast a reload (scripts/devReload.mjs) so a phone left open
//      across a Metro restart stops serving the bundle it loaded before
//      that restart. This is the step that makes re-running the script a
//      real answer to "is my phone on current code?" rather than a no-op.
//   7. Print the exp:// url to open in Expo Go on the phone. Unlike the
//      emulator this can't force-launch it over adb.
//
// Ports come from the slot this worktree claims (scripts/devRegistry.mjs),
// so two worktrees running this at once never collide.

import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { claimThisWorktreeSlot } from "./devClaim.mjs";
import { devDataDirEnv } from "./devDataDir.mjs";
import { DEV_USERNAME } from "./dev-account.mjs";
import { ensureSharedBuilt, resetDevDataIfRequested, seedDevAccount, seedFixtureUsers } from "./devFixtureSetup.mjs";
import { isPortOpen, spawnDetached, waitFor } from "./devProcess.mjs";
import { metroCacheEnv } from "./devMetroCache.mjs";
import { broadcastReload } from "./devReload.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const mobileDir = join(repoRoot, "mobile");
const runtimeDir = join(tmpdir(), "scripta-dev-phone");
const resetRequested = process.argv.includes("--reset");
let BACKEND_PORT;
let METRO_PORT;
let lanAddress;

function log(message) {
  console.log(`[dev-phone] ${message}`);
}

// Claims this worktree's slot with LAN transport before anything else
// runs, so backend/Metro ports AND mobile/.env.local's API url all come
// from the same claim — see scripts/devClaim.mjs and devSlotEnv.mjs.
// `LAN_IP` overrides auto-detection, matching backend/scripts/dev-
// mobile.mjs's own escape hatch for a machine with multiple network
// interfaces (VPN, Docker bridge) where the guess is wrong.
async function claimThisWorktree() {
  lanAddress = process.env.LAN_IP ?? pickLanAddress();
  if (!lanAddress) {
    throw new Error(
      "couldn't find a LAN address on any network interface — is this machine on Wi-Fi/Ethernet? " +
        "Pass one explicitly: LAN_IP=192.168.1.20 node scripts/dev-phone.mjs",
    );
  }
  const { slot, ports, branch } = await claimThisWorktreeSlot({ repoRoot, transport: "lan", lanAddress });
  BACKEND_PORT = ports.backend;
  METRO_PORT = ports.metro;
  log(`Slot ${slot} — backend ${ports.backend}, Metro ${ports.metro} (${branch}), LAN address ${lanAddress}.`);
}

// Anything already listening on this slot's backend port is assumed to
// be this worktree's own server, started by this same script (or
// dev-emulator.mjs) on an earlier run — claimSlot refuses the slot
// otherwise. It is NOT verified to be running in LAN mode against
// backend/data/dev/: starting it any other way (a bare `npm run
// backend` in this worktree) leaves a mismatched server behind that
// looks adopted here. `npm run dev:release` first if in doubt.
//
// Sets backend/scripts/dev-mobile.mjs's own two env vars directly
// (PUBLIC_API_URL, ALLOW_LAN_ORIGINS) rather than running `npm run
// dev:mobile` itself: that script also auto-switches to https whenever
// `.certs/mobile-*.pem` exist (backend/src/config/devCerts.ts), which
// is right for the PWA install/offline story (root README's "Testing on
// a phone") but wrong here — Expo Go does not trust that cert the way a
// browser does, and a mismatch there reproduces exactly the symptom
// this script exists to avoid: the app looking unreachable for a reason
// that has nothing to do with the account or database underneath it.
async function ensureBackendRunning() {
  if (await isPortOpen(BACKEND_PORT)) {
    log(`Backend already listening on ${BACKEND_PORT} for this slot.`);
    return;
  }
  log("Starting the backend in LAN mode (plain http)...");
  const env = {
    ...process.env,
    ...devDataDirEnv(),
    PUBLIC_API_URL: `http://${lanAddress}:${BACKEND_PORT}`,
    ALLOW_LAN_ORIGINS: "true",
  };
  spawnDetached("npm", ["run", "dev", "--workspace", "backend"], { cwd: repoRoot, env, logName: "backend.log", runtimeDir });
  await waitFor(() => isPortOpen(BACKEND_PORT), { timeoutMs: 30_000, label: `backend on port ${BACKEND_PORT}` });
}

async function ensureMetroRunning() {
  if (await isPortOpen(METRO_PORT)) {
    log(`Metro already listening on ${METRO_PORT}.`);
    return;
  }
  log("Starting Metro, advertising on the LAN...");
  // Same worktree-scoped bundler cache as dev-emulator.mjs — see
  // devMetroCache.mjs. A phone is the harder case to catch it on: there is no
  // adb to dump the screen and prove which branch's code is running.
  const metroEnv = { ...process.env, ...metroCacheEnv(repoRoot) };
  spawnDetached("npx", ["expo", "start", "--port", String(METRO_PORT)], { cwd: mobileDir, env: metroEnv, logName: "metro.log", runtimeDir });
  await waitFor(() => isPortOpen(METRO_PORT), { timeoutMs: 60_000, label: `Metro on port ${METRO_PORT}` });
}

async function main() {
  await claimThisWorktree();
  ensureSharedBuilt(log);
  resetDevDataIfRequested(resetRequested, log);
  seedDevAccount(resetRequested, log);
  seedFixtureUsers(log);
  await ensureBackendRunning();
  await ensureMetroRunning();
  // Expo Go keeps running the bundle it already has when its Metro is
  // replaced, so re-running this script could not fix the very thing it is
  // most often re-run for. This says whether the reload reached METRO, not
  // whether a phone was listening — Metro's /message broadcast gives no
  // count of attached clients, and claiming one it can't see is how the
  // stale bundle stayed invisible in the first place.
  const reloadSent = await broadcastReload(METRO_PORT);
  log(reloadSent
    ? "Sent a reload to Metro — an Expo Go already attached picks up current code without you touching the phone."
    : `Couldn't reach Metro's reload channel on ${METRO_PORT} — if the app is already open, shake the phone and tap Reload.`);

  log(`Ready. Signed in as ${DEV_USERNAME} (24-book fixture library). fixture_alice/fixture_bob/fixture_charlie (password scripta123) are also seeded on the same server.`);
  log(`On your phone (same Wi-Fi), open Expo Go and enter: exp://${lanAddress}:${METRO_PORT}`);
  log("Google sign-in and social connections won't work over LAN — their callback urls point at localhost.");
  log("`npm run dev:release` frees this slot's ports when you're done.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
