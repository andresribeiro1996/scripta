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
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { devDataDir, devDataDirEnv } from "./devDataDir.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const backendDir = join(repoRoot, "backend");

/** `packages/shared`'s compiled `dist/` is gitignored (it's a build
 *  artifact, not source) and every existing setup story — root README,
 *  mobile/README.md — already says to `npm install` then build it. A
 *  fresh worktree (or one that just pulled a change to it) just as often
 *  has skipped that step, though, and the failure mode (Metro's "Unable
 *  to resolve @scripta/shared", or the backend crashing on an import it
 *  expects to exist) doesn't say so — so this checks for it rather than
 *  letting that confusing error be the first thing a caller produces. */
export function ensureSharedBuilt(log) {
  if (existsSync(join(repoRoot, "packages/shared/dist/index.js"))) return;
  log("Building @scripta/shared (first run in this worktree)...");
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
