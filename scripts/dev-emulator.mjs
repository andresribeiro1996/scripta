#!/usr/bin/env node
// One command from a cold machine to a running, driveable Scripta —
// see mobile/README.md's "Testing on an emulator" section for the story
// this replaces (a physical phone that locks itself and can't be scripted).
//
// Idempotent: safe to re-run any time. Each step checks whether its own
// thing is already up before starting anything — re-running while
// everything is already running just re-launches Expo Go against the
// current bundle, which is the point (see it now, not "nothing to do").
// Pass --reset to wipe backend/data/dev/ first (a whole-directory wipe —
// there is no per-user teardown across these modules, see devDataDir.mjs)
// and reseed everything from scratch; without it, existing dev-account
// and fixture-user progress survives a re-run.
//
//   0. Claim this worktree's port slot from the shared registry
//      (scripts/devRegistry.mjs) and lease one of the two AVDs
//      (scripta-dev-0/1) from the same registry — see docs/dev-workflow.md
//      for when to take one. `npm run dev:release` hands both back.
//   1. Boot the leased AVD if it isn't already running (creating it
//      first, on a machine that's never run this before). No lock
//      screen, no screen timeout — the whole reason this script exists.
//   2. Sideload Expo Go if this AVD doesn't have it (the `google_apis`
//      image has no Play Store to install it from normally).
//   3. --reset only: wipe backend/data/dev/ so every module starts clean.
//   4. Seed the dev account + fixture library (scripts/dev-account.mjs,
//      writing into backend/data/dev/), then seed the three fixture
//      users (fixture_alice/bob/charlie, backend/scripts/three-users.mjs
//      --seed-only --shared) into that SAME directory — one database,
//      four logins.
//   5. Start the real backend (plain http — an emulator reaches the
//      host's localhost through `adb reverse`, so unlike a physical
//      phone this never needs the LAN-IP/HTTPS dance `dev-mobile.mjs`
//      does) against backend/data/dev/, and Metro, if either isn't
//      already running. Anything already listening on this slot's
//      backend port is this worktree's own server by construction —
//      claimSlot refuses the slot if the port was externally occupied —
//      so this just adopts it rather than re-verifying who it is.
//   6. `adb reverse` both ports, then open Expo Go at the project and
//      wait for the first bundle to land.
//
// Ports are never hardcoded: BACKEND_PORT and METRO_PORT come from the
// slot this worktree claims at startup (scripts/devRegistry.mjs), so two
// worktrees running this script at once land on different, non-
// overlapping ports and never contend for the same one.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { androidEnv } from "./androidSdk.mjs";
import { devDataDirEnv } from "./devDataDir.mjs";
import { DEV_USERNAME } from "./dev-account.mjs";
import { assertAdoptedBackendMatches, ensureSharedBuilt, resetDevDataIfRequested, seedCommunityGraph, seedDevAccount, seedFixtureUsers } from "./devFixtureSetup.mjs";
import { upsertEnvLine } from "./devEnvFile.mjs";
import { claimThisWorktreeSlot } from "./devClaim.mjs";
import { assertHoldsDevice, recordDeviceSerial, registryPath, takeDevice } from "./devRegistry.mjs";
import { isReachableOn, worktreeIdentity } from "./devHost.mjs";
import { metroCacheEnv } from "./devMetroCache.mjs";
import { isPortOpen, mkdirRuntimeDir, spawnDetached, waitFor } from "./devProcess.mjs";
import { pickLanAddress } from "./lanAddress.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(repoRoot, "backend");
const mobileDir = join(repoRoot, "mobile");
const runtimeDir = join(tmpdir(), "scripta-dev-emulator");
const resetRequested = process.argv.includes("--reset");
const lanRequested = process.argv.includes("--lan");
const slotArg = process.argv.indexOf("--slot");
const requestedSlot = slotArg < 0 ? undefined : Number(process.argv[slotArg + 1]);
let BACKEND_PORT;
let METRO_PORT;
let claimedSlot;
let isPortFree;

function log(message) {
  console.log(`[dev-emulator] ${message}`);
}

// Bounded, because `adb -s <serial> emu avd name` never answers for a
// hung emulator and this helper is called inside a poll loop. spawnSync
// returns stdout/stderr as null when it kills a timed-out child, so both
// are normalised — every caller here does string work on them.
function run(command, args, { env, timeoutMs = 15_000 } = {}) {
  const result = spawnSync(command, args, { env, encoding: "utf8", timeout: timeoutMs });
  // A killed child is otherwise indistinguishable from a quiet success —
  // a timed-out `adb reverse` used to resurface only 180 seconds later as
  // "Timed out waiting for: first bundle". Warn, never throw: every
  // caller here already handles its own failure.
  if (result.error?.code === "ETIMEDOUT") {
    log(`Warning: \`${command} ${args.join(" ")}\` timed out after ${timeoutMs}ms and was killed.`);
  }
  return { ...result, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// `avdmanager create avd --force` OVERWRITES an existing AVD, so a failed
// or timed-out `avdmanager list avd` must read as "unknown — do not
// recreate", never as "absent". spawnSync reports a killed child in
// `error` and a real failure in a non-zero `status`; only a clean exit
// makes the empty-list conclusion trustworthy.
export function shouldCreateAvd(result, avd) {
  if (result.error !== undefined && result.error !== null) return false;
  if (result.status !== 0) return false;
  return !(result.stdout ?? "").includes(avd);
}

// Pure decision function — given `adb devices` output and a name-lookup
// function (real callers: `adb -s <serial> emu avd name`), returns the
// serial of the emulator running THIS avd, or null. Two AVDs
// (scripta-dev-0/1) can be booted concurrently now that the device lease
// is a two-slot semaphore rather than a mutex, so "the first emulator in
// `device` state" is no longer a safe stand-in for "my emulator" — that
// mistake is Finding C1: it makes one worktree's ensureAvdBooted report
// another worktree's AVD as its own, then `adb reverse` its ports onto
// the wrong device. Only `device`-state lines are even considered:
// `offline`/`unauthorized` entries are excluded before the name lookup
// ever runs, since a serial in either of those states cannot answer `emu
// avd name` usefully anyway.
export function pickSerialForAvd(devicesOutput, avd, avdNameForSerial) {
  const serials = devicesOutput
    .split("\n")
    .filter((line) => /^emulator-\d+\s+device\b/.test(line))
    .map((line) => line.split(/\s+/)[0]);
  return serials.find((serial) => avdNameForSerial(serial) === avd) ?? null;
}

// `adb -s <serial> emu avd name` prints the AVD name followed by a
// trailing "OK" line (verified on this machine) — this returns the first
// non-blank line, trimmed, which is the name whether or not there are
// leading blank lines or incidental whitespace around it.
export function parseAvdNameOutput(stdout) {
  const line = stdout.split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim() : null;
}

function avdNameForSerial(serial, env) {
  return parseAvdNameOutput(run("adb", ["-s", serial, "emu", "avd", "name"], { env }).stdout);
}

function getEmulatorSerial(avd, env) {
  const { stdout } = run("adb", ["devices"], { env });
  return pickSerialForAvd(stdout, avd, (serial) => avdNameForSerial(serial, env));
}

async function ensureAvdBooted(avd, env) {
  let serial = getEmulatorSerial(avd, env);
  if (serial) {
    log(`${avd} already running as ${serial}.`);
  } else {
    const listed = run("avdmanager", ["list", "avd"], { env });
    if (shouldCreateAvd(listed, avd)) {
      log(`Creating the ${avd} AVD (first run on this machine)...`);
      const create = spawnSync(
        "avdmanager",
        ["create", "avd", "-n", avd, "-k", "system-images;android-35;google_apis;arm64-v8a", "--force"],
        { env, input: "no\n", encoding: "utf8" },
      );
      if (create.status !== 0) throw new Error(`Failed to create AVD:\n${create.stdout}\n${create.stderr}`);
    }
    log(`Booting ${avd}...`);
    spawnDetached("emulator", ["-avd", avd, "-no-boot-anim", "-no-audio"], { env, logName: "emulator.log", runtimeDir });
    await waitFor(() => Boolean(getEmulatorSerial(avd, env)), { timeoutMs: 120_000, label: "emulator to register with adb" });
    serial = getEmulatorSerial(avd, env);
  }
  await waitFor(
    () => run("adb", ["-s", serial, "shell", "getprop", "sys.boot_completed"], { env }).stdout.trim() === "1",
    { timeoutMs: 120_000, label: "emulator boot to complete" },
  );
  return serial;
}

async function ensureExpoGo(serial, env) {
  const { stdout } = run("adb", ["-s", serial, "shell", "pm", "list", "packages"], { env });
  if (stdout.includes("host.exp.exponent")) {
    log("Expo Go already installed.");
    return;
  }
  const expoDependency = JSON.parse(readFileSync(join(mobileDir, "package.json"), "utf8")).dependencies.expo;
  const sdkMajor = expoDependency.match(/\d+/)[0];
  log(`Installing Expo Go for SDK ${sdkMajor}...`);
  const versions = await fetch("https://api.expo.dev/v2/versions/latest").then((r) => r.json());
  const apkUrl = versions.data.sdkVersions[`${sdkMajor}.0.0`]?.androidClientUrl;
  if (!apkUrl) throw new Error(`No Expo Go APK listed for SDK ${sdkMajor}.0.0 — check https://api.expo.dev/v2/versions/latest`);
  const apkBytes = await fetch(apkUrl).then((r) => r.arrayBuffer());
  mkdirRuntimeDir(runtimeDir);
  const apkPath = join(runtimeDir, "expo-go.apk");
  writeFileSync(apkPath, Buffer.from(apkBytes));
  // The ~100 MB Expo Go APK, with dex optimisation on first install,
  // routinely outruns run()'s 15s default — that default exists to bound
  // the fast adb calls (devices/getprop/emu avd name/reverse), not this
  // one, so it's overridden here rather than raised globally.
  const install = run("adb", ["-s", serial, "install", apkPath], { env, timeoutMs: 300_000 });
  if (!install.stdout.includes("Success")) throw new Error(`adb install failed:\n${install.stdout}\n${install.stderr}`);
}

async function ensureBackendRunning() {
  if (await isPortOpen(BACKEND_PORT)) {
    assertAdoptedBackendMatches(BACKEND_PORT, log);
    log(`Backend already listening on ${BACKEND_PORT} for this slot.`);
    return;
  }
  log("Starting the backend...");
  const env = { ...process.env, ...devDataDirEnv() };
  spawnDetached("npm", ["run", "backend"], { cwd: repoRoot, env, logName: "backend.log", runtimeDir });
  await waitFor(() => isPortOpen(BACKEND_PORT), { timeoutMs: 30_000, label: `backend on port ${BACKEND_PORT}` });
}

// Exported and pure so the composition — appending rather than
// clobbering an existing NODE_OPTIONS, and not duplicating the flag on a
// second call — is unit-tested without spawning anything.
export function metroNodeOptions(existing) {
  const flag = "--dns-result-order=ipv4first";
  if (existing?.includes(flag)) return existing;
  return [existing, flag].filter(Boolean).join(" ");
}

async function ensureMetroRunning() {
  // adb reverse (below) makes the emulator's own 127.0.0.1 resolve to
  // this machine, exactly like a real device over USB — so unlike
  // dev-mobile.mjs's LAN-IP dance for a physical phone, the emulator can
  // just use loopback.
  upsertEnvLine(join(mobileDir, ".env.local"), "EXPO_PUBLIC_API_URL", `http://127.0.0.1:${BACKEND_PORT}`);
  if (await isPortOpen(METRO_PORT)) {
    log(`Metro already listening on ${METRO_PORT}.`);
    return join(runtimeDir, "metro.log");
  }
  log("Starting Metro...");
  // `--localhost`, not Expo's default `--lan`: LAN advertisement is how
  // Expo Go ends up connected to a DIFFERENT worktree's Metro after a
  // reload or crash (every Metro on the network shows on every device's
  // home screen). The emulator only ever reaches Metro through the adb
  // reverse tunnel below, so LAN advertisement buys this path nothing.
  //
  // `--localhost` alone is not enough, though — measured on this
  // machine: Expo passes the literal string "localhost" to Node's
  // `http.Server#listen`, which resolves it to [::1] first (IPv6
  // loopback, not dual-stack), while `adb reverse tcp:N tcp:N` forwards
  // the device's connection to the host's IPv4 127.0.0.1. Nothing
  // listens there, so Expo Go opens and never fetches a bundle. Forcing
  // Node's own resolver to prefer IPv4 fixes it: verified end-to-end
  // against a real emulator (bundle served, app loaded) with
  // NODE_OPTIONS=--dns-result-order=ipv4first.
  //
  // This leans on Node's resolution order rather than an option Expo
  // exposes, so it is verified below rather than trusted: physical-phone
  // testing still needs LAN and has its own path (`npm run dev:mobile`,
  // backend/scripts/dev-mobile.mjs), untouched by this.
  const metroEnv = {
    ...process.env,
    NODE_OPTIONS: metroNodeOptions(process.env.NODE_OPTIONS),
    // Keeps this worktree's bundler cache out of every other worktree's —
    // see devMetroCache.mjs for what sharing it does, which is serve the
    // emulator another branch's code with no sign that it has.
    ...metroCacheEnv(repoRoot),
  };
  const logPath = spawnDetached("npx", ["expo", "start", "--localhost", "--port", String(METRO_PORT)], { cwd: mobileDir, env: metroEnv, logName: "metro.log", runtimeDir });
  await waitFor(() => isPortOpen(METRO_PORT), { timeoutMs: 60_000, label: `Metro on port ${METRO_PORT}` });

  // The active check the reasoning above earns: confirm Metro actually
  // answers on 127.0.0.1 — the address the tunnel forwards to — rather
  // than trusting that the flag combination above bound the interface it
  // claims to. A future Expo/Node version that stops honoring this is a
  // loud, specific failure here, not a silent "app never bundles" a
  // developer has to rediscover from scratch.
  if (!(await isReachableOn(METRO_PORT, "127.0.0.1"))) {
    throw new Error(
      `Metro is listening on ${METRO_PORT} but not reachable on 127.0.0.1 — the emulator's adb reverse tunnel forwards there, so it would open Expo Go and never fetch a bundle. ` +
        "This worked via NODE_OPTIONS=--dns-result-order=ipv4first when last verified; check whether Expo's --localhost handling changed.",
    );
  }
  return logPath;
}

// Claims this worktree's slot before anything else runs, so every port
// this script touches — backend, Metro, and the emulator it leases next —
// is derived from that slot rather than a hardcoded number some other
// worktree might already be using. The claim itself (resource gate, port
// probe, registry write, env files) is the shared step in
// scripts/devClaim.mjs — `npm run backend`/`frontend` run the same one.
async function claimThisWorktree() {
  const claim = await claimThisWorktreeSlot({
    repoRoot,
    transport: lanRequested ? "lan" : "loopback",
    lanAddress: lanRequested ? pickLanAddress() : undefined,
    requestedSlot,
  });
  const { slot, ports, branch } = claim;

  claimedSlot = slot;
  isPortFree = claim.isPortFree;
  BACKEND_PORT = ports.backend;
  METRO_PORT = ports.metro;

  log(`Slot ${slot} — backend ${ports.backend}, web ${ports.vite}, Metro ${ports.metro} (${branch}).`);
}

async function main() {
  await claimThisWorktree();
  ensureSharedBuilt(log);
  const env = { ...process.env, ...androidEnv() };
  const { worktree } = worktreeIdentity(repoRoot);
  const path = registryPath(repoRoot);
  const { avd } = takeDevice({ path, worktree, pid: process.pid, isPortFree });
  log(`Holding ${avd}. Release it with \`npm run dev:release\` when you're done verifying.`);
  const serial = await ensureAvdBooted(avd, env);
  recordDeviceSerial({ path, worktree, avd, serial });
  await ensureExpoGo(serial, env);

  resetDevDataIfRequested(resetRequested, log);
  seedDevAccount(resetRequested, log);
  seedFixtureUsers(log);
  seedCommunityGraph(log);
  await ensureBackendRunning();
  const metroLogPath = await ensureMetroRunning();

  assertHoldsDevice({ path, worktree, avd });
  run("adb", ["-s", serial, "reverse", `tcp:${METRO_PORT}`, `tcp:${METRO_PORT}`], { env });
  run("adb", ["-s", serial, "reverse", `tcp:${BACKEND_PORT}`, `tcp:${BACKEND_PORT}`], { env });

  log("Opening Expo Go...");
  run("adb", ["-s", serial, "shell", "am", "force-stop", "host.exp.exponent"], { env });
  run("adb", ["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", `exp://127.0.0.1:${METRO_PORT}`], { env });

  await waitFor(
    () => {
      try {
        return readFileSync(metroLogPath, "utf8").includes("Android Bundled");
      } catch {
        return false;
      }
    },
    { timeoutMs: 180_000, label: "first bundle to finish" },
  );

  log(`Ready. Serial: ${serial}. Signed in as ${DEV_USERNAME} (24-book fixture library). fixture_alice/fixture_bob/fixture_charlie (password scripta123) are also seeded on the same server for multi-user testing.`);
  log(`Drive it with: adb -s ${serial} shell uiautomator dump /sdcard/ui.xml && adb -s ${serial} pull /sdcard/ui.xml .`);
  log(`Screenshot with: adb -s ${serial} exec-out screencap -p > screen.png`);
}

// Guarded like dev-account.mjs's own main(): tests import this module for
// its pure functions (pickSerialForAvd, parseAvdNameOutput) and must not
// trigger a real boot — claiming a slot, leasing a device, starting the
// backend and Metro against the live emulator — as a side effect of that
// import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
