// Shared by dev-account.mjs and dev-emulator.mjs (and, in --shared mode,
// backend/scripts/three-users.mjs): the single dedicated data directory
// the "one real server, one seeded dev database" workflow uses —
// backend/data/dev/ — plus the *_DB_PATH/*_STORAGE_PATH overrides that
// point a spawned or imported backend at it instead of backend/.env's
// own paths.
//
// Deliberately separate from backend/data/*.sqlite (a developer's own,
// untouched by this workflow) and from backend/data/three-users/ (the
// OLD isolated fixture directory, still used by three-users.mjs's
// default/--check modes, unrelated to this one).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const devDataDir = join(repoRoot, "backend", "data", "dev");

const DB_MODULES = ["auth", "library", "gallery", "covers", "socials", "arena", "murals", "tierlists"];
const STORAGE_MODULES = ["gallery", "avatar", "covers"];

/** Env var overrides that point a backend process (spawned or dynamically
 *  imported) at devDataDir instead of whatever backend/.env says. Callers
 *  apply these on top of process.env/child env — they must win over
 *  .env, never the other way around. */
export function devDataDirEnv(directory = devDataDir) {
  const env = {};
  for (const module of DB_MODULES) env[`${module.toUpperCase()}_DB_PATH`] = join(directory, `${module}.sqlite`);
  for (const storage of STORAGE_MODULES) env[`${storage.toUpperCase()}_STORAGE_PATH`] = join(directory, `${storage}-files`);
  return env;
}
