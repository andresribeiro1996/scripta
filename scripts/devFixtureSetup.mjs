// The "get a signed-in dev backend" steps shared by dev-emulator.mjs
// (emulator, adb reverse) and dev-phone.mjs (physical phone, LAN). Kept
// as one shared module rather than two copies on purpose: see the
// dev-account-fixture-login memory — the trap that cost real debugging
// time was exactly two dev workflows each doing their own version of
// "start the backend" and quietly drifting onto two different
// databases (backend/data/* vs backend/data/dev/). Sharing these calls
// makes that class of bug structurally impossible instead of merely
// documented.

import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devDataDir, devDataDirEnv } from "./devDataDir.mjs";
import { describeMismatch, mismatchedEnv, readProcessEnv } from "./devBackendEnv.mjs";
import { readListeners } from "./devListeners.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(repoRoot, "backend");

/** Refuses a backend on this slot's port whose environment differs from the
 *  expected one (the dev data directory by default). Silent about the normal case, and silent when
 *  the running environment can't be read at all — see devBackendEnv.mjs. */
export function assertAdoptedBackendMatches(port, log, expected = devDataDirEnv()) {
  const listeners = readListeners();
  const pid = listeners[port]?.[0];
  if (pid === undefined) return;
  const running = readProcessEnv(pid);
  if (!running) {
    log(`Adopting the backend on ${port} without checking its environment — couldn't read the environment of pid ${pid}.`);
    return;
  }
  const rows = mismatchedEnv(running, expected);
  if (rows.length) throw new Error(describeMismatch(port, rows));
}

export function sharedDistIsStale(sharedDir) {
  const built = statSync(join(sharedDir, "dist/index.js"), { throwIfNoEntry: false });
  if (!built) return true;
  return readdirSync(join(sharedDir, "src"), { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && !entry.name.endsWith(".test.ts") && statSync(join(entry.parentPath, entry.name)).mtimeMs > built.mtimeMs,
  );
}

/** `packages/shared`'s compiled `dist/` is gitignored (it's a build
 *  artifact, not source) and every existing setup story — root README,
 *  mobile/README.md — already says to `npm install` then build it. A
 *  fresh worktree (or one that just pulled a change to it) just as often
 *  has skipped that step, though, and the failure mode (Metro's "Unable
 *  to resolve @scripta/shared", or the backend crashing on an import it
 *  expects to exist) doesn't say so — so this checks for it rather than
 *  letting that confusing error be the first thing a caller produces. */
export function ensureSharedBuilt(log) {
  if (!sharedDistIsStale(join(repoRoot, "packages/shared"))) return;
  log("Building @scripta/shared (dist missing or older than src)...");
  const result = spawnSync("npm", ["run", "build", "--workspace", "@scripta/shared"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("Building @scripta/shared failed — see output above.");
}

export function resetDevDataIfRequested(resetRequested, log) {
  if (!resetRequested) return;
  log(`--reset: wiping ${devDataDir}...`);
  rmSync(devDataDir, { recursive: true, force: true });
}

export function seedDevAccount(resetRequested, log) {
  log("Seeding the dev account + fixture library...");
  const args = ["--import", "tsx", "scripts/dev-account.mjs", ...(resetRequested ? ["--reset"] : [])];
  const result = spawnSync("node", args, { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error("scripts/dev-account.mjs failed — see output above.");
}

/** Seeds fixture_alice/bob/charlie into the SAME backend/data/dev/
 *  database dev-account.mjs just wrote to (devDataDirEnv() below is what
 *  makes --shared mode point there instead of the isolated
 *  backend/data/three-users/ default — see three-users.mjs's own
 *  comment). --seed-only: this never starts its own server: the real
 *  backend, started next, serves both the dev account and these three. */
export function seedFixtureUsers(log) {
  log("Seeding fixture_alice/bob/charlie into the same dev database...");
  const env = { ...process.env, ...devDataDirEnv() };
  const result = spawnSync("node", ["--import", "tsx", "scripts/three-users.mjs", "--seed-only", "--shared"], { cwd: backendDir, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("backend/scripts/three-users.mjs --shared failed — see output above.");
}

/** Publishes profiles and wires follows between the dev account and the
 *  fixture users. Separate from the two seeds above because it needs both
 *  to exist first: the feed is other people's events, so it has nothing to
 *  show until somebody follows somebody. */
export function seedCommunityGraph(log) {
  log("Wiring profiles and follows between the dev account and the fixture users...");
  const env = { ...process.env, ...devDataDirEnv() };
  const result = spawnSync("node", ["--import", "tsx", "scripts/dev-community.mjs"], { cwd: repoRoot, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("scripts/dev-community.mjs failed — see output above.");
}

/** Adds catalog works with several editions (The Hobbit, which the dev
 *  account owns, and Dune, which nobody does) so the work page's edition
 *  strip appears. Runs right after seedDevAccount and before anything that
 *  boots the backend, so the dev library resolves onto these works (its owned
 *  edition last) instead of creating The Hobbit's work on its own. */
export function seedEditionWorks(log) {
  log("Seeding catalog works with several editions...");
  const env = { ...process.env, ...devDataDirEnv() };
  const result = spawnSync("node", ["--import", "tsx", "scripts/dev-editions.mjs"], { cwd: repoRoot, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error("scripts/dev-editions.mjs failed — see output above.");
}
