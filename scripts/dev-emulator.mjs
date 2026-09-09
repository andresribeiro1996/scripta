#!/usr/bin/env node
// One command from a cold machine to a running, driveable Scripta —
// see mobile/README.md's "Testing on an emulator" section for the story
// this replaces (a physical phone that locks itself and can't be scripted).
//
// Idempotent: safe to re-run any time. Each step checks whether its own
// thing is already up before starting anything — re-running while
// everything is already running just re-launches Expo Go against the
// current bundle, which is the point (see it now, not "nothing to do").
//
//   1. Boot the `scripta-dev` AVD if it isn't already running (creating
//      it first, on a machine that's never run this before). No lock
//      screen, no screen timeout — the whole reason this script exists.
//   2. Sideload Expo Go if this AVD doesn't have it (the `google_apis`
//      image has no Play Store to install it from normally).
//   3. Seed the dev account + fixture library (scripts/dev-account.mjs).
//   4. Start the backend (plain http — an emulator reaches the host's
//      localhost through `adb reverse`, so unlike a physical phone this
//      never needs the LAN-IP/HTTPS dance `dev-mobile.mjs` does) and
//      Metro, if either isn't already running.
//   5. `adb reverse` both ports, then open Expo Go at the project and
//      wait for the first bundle to land.
//
// Assumes ports 3000 (backend) and 8081 (Metro, Expo's default) are free
// or already running THIS script's own servers — fine for a single-
// developer machine with one emulator, not something this script tries
// to disambiguate further.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { androidEnv } from "./androidSdk.mjs";
import { upsertEnvLine } from "./devEnvFile.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(repoRoot, "backend");
const mobileDir = join(repoRoot, "mobile");
const runtimeDir = join(tmpdir(), "scripta-dev-emulator");
const AVD_NAME = "scripta-dev";
const BACKEND_PORT = 3000;
const METRO_PORT = 8081;

function log(message) {
  console.log(`[dev-emulator] ${message}`);
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitFor(check, { timeoutMs, intervalMs = 2000, label }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

/** Spawns a long-lived background process, stdout/stderr redirected to a
 *  log file under the OS tmpdir — never the repo. Detached + unref()'d so
 *  it outlives this script, matching how a developer would normally leave
 *  a dev server running in its own terminal tab. */
function spawnDetached(command, args, { cwd, env, logName }) {
  mkdirRuntimeDir();
  const logPath = join(runtimeDir, logName);
  // Truncated ("w"), not appended: a stale log from a previous run (or a
  // previous invocation's failed attempt) must never be mistaken for
  // output from the process this call actually just started.
  const fd = openSync(logPath, "w");
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  return logPath;
}

function mkdirRuntimeDir() {
  spawnSync("mkdir", ["-p", runtimeDir]);
}

function run(command, args, { env } = {}) {
  return spawnSync(command, args, { env, encoding: "utf8" });
}

function getEmulatorSerial(env) {
  const { stdout } = run("adb", ["devices"], { env });
  const match = stdout.split("\n").find((line) => /^emulator-\d+\s+device\b/.test(line));
  return match ? match.split(/\s+/)[0] : null;
}

async function ensureAvdBooted(env) {
  let serial = getEmulatorSerial(env);
  if (serial) {
    log(`${AVD_NAME} already running as ${serial}.`);
  } else {
    const { stdout: avds } = run("avdmanager", ["list", "avd"], { env });
    if (!avds.includes(AVD_NAME)) {
      log(`Creating the ${AVD_NAME} AVD (first run on this machine)...`);
      const create = spawnSync(
        "avdmanager",
        ["create", "avd", "-n", AVD_NAME, "-k", "system-images;android-35;google_apis;arm64-v8a", "--force"],
        { env, input: "no\n", encoding: "utf8" },
      );
      if (create.status !== 0) throw new Error(`Failed to create AVD:\n${create.stdout}\n${create.stderr}`);
    }
    log(`Booting ${AVD_NAME}...`);
    spawnDetached("emulator", ["-avd", AVD_NAME, "-no-boot-anim", "-no-audio"], { env, logName: "emulator.log" });
    await waitFor(() => Boolean(getEmulatorSerial(env)), { timeoutMs: 120_000, label: "emulator to register with adb" });
    serial = getEmulatorSerial(env);
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
  mkdirRuntimeDir();
  const apkPath = join(runtimeDir, "expo-go.apk");
  writeFileSync(apkPath, Buffer.from(apkBytes));
  const install = run("adb", ["-s", serial, "install", apkPath], { env });
  if (!install.stdout.includes("Success")) throw new Error(`adb install failed:\n${install.stdout}\n${install.stderr}`);
}

/** `packages/shared`'s compiled `dist/` is gitignored (it's a build
 *  artifact, not source) and every existing setup story — root README,
 *  mobile/README.md — already says to `npm install` then build it. A
 *  fresh worktree just as often has skipped that step, though, and the
 *  failure mode (Metro's "Unable to resolve @scripta/shared", deep in a
 *  bundling error) doesn't say so — so this checks for it rather than
 *  letting that confusing error be the first thing the script produces. */
function ensureSharedBuilt() {
  if (existsSync(join(repoRoot, "packages/shared/dist/index.js"))) return;
  log("Building @scripta/shared (first run in this worktree)...");
  const result = spawnSync("npm", ["run", "build", "--workspace", "@scripta/shared"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Building @scripta/shared failed — see output above.");
}

function seedDevAccount() {
  log("Seeding the dev account + fixture library...");
  const result = spawnSync("node", ["--import", "tsx", "scripts/dev-account.mjs"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("scripts/dev-account.mjs failed — see output above.");
}

async function ensureBackendRunning() {
  if (await isPortOpen(BACKEND_PORT)) {
    log(`Backend already listening on ${BACKEND_PORT}.`);
    return;
  }
  log("Starting the backend...");
  spawnDetached("npm", ["run", "backend"], { cwd: repoRoot, env: process.env, logName: "backend.log" });
  await waitFor(() => isPortOpen(BACKEND_PORT), { timeoutMs: 30_000, label: `backend on port ${BACKEND_PORT}` });
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
  const logPath = spawnDetached("npx", ["expo", "start", "--port", String(METRO_PORT)], { cwd: mobileDir, env: process.env, logName: "metro.log" });
  await waitFor(() => isPortOpen(METRO_PORT), { timeoutMs: 60_000, label: `Metro on port ${METRO_PORT}` });
  return logPath;
}

async function main() {
  ensureSharedBuilt();
  const env = { ...process.env, ...androidEnv() };
  const serial = await ensureAvdBooted(env);
  await ensureExpoGo(serial, env);

  seedDevAccount();
  await ensureBackendRunning();
  const metroLogPath = await ensureMetroRunning();

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

  log(`Ready. Serial: ${serial}. Signed in as the dev account with the fixture library.`);
  log(`Drive it with: adb -s ${serial} shell uiautomator dump /sdcard/ui.xml && adb -s ${serial} pull /sdcard/ui.xml .`);
  log(`Screenshot with: adb -s ${serial} exec-out screencap -p > screen.png`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
