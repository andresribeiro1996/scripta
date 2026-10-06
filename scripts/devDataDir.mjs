// Shared by dev-account.mjs and dev-emulator.mjs (and, in --shared mode,
// backend/scripts/three-users.mjs): the single dedicated data directory
// the "one real server, one seeded dev database" workflow uses —
// backend/data/dev/ — plus the *_DB_PATH and FILES_STORAGE_PATH overrides that
// point a spawned or imported backend at it instead of backend/.env's
// own paths.
//
// Deliberately separate from backend/data/*.sqlite (a developer's own,
// untouched by this workflow) and from backend/data/three-users/ (the
// OLD isolated fixture directory, still used by three-users.mjs's
// default/--check modes, unrelated to this one).

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export const devDataDir = join(repoRoot, "backend", "data", "dev");

// `community` belongs here for the same reason as every other module, and
// its absence was invisible in a way the others' would not be: the feed
// still rendered, just out of the developer's own backend/data/community.
// sqlite, so follows and events resolved against ids from a different
// auth database than the one the dev account lives in.
const DB_MODULES = ["auth", "library", "gallery", "covers", "socials", "arena", "murals", "tierlists", "community"];

/** Env var overrides that point a backend process (spawned or dynamically
 *  imported) at devDataDir instead of whatever backend/.env says. Callers
 *  apply these on top of process.env/child env — they must win over
 *  .env, never the other way around. */
export function devDataDirEnv(directory = devDataDir) {
  const env = {};
  for (const module of DB_MODULES) env[`${module.toUpperCase()}_DB_PATH`] = join(directory, `${module}.sqlite`);
  env.FILES_STORAGE_PATH = join(directory, "files");
  return env;
}

function moveFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (!existsSync(to)) renameSync(from, to);
}

/** Moves images an older backend left in covers-files/, gallery-files/
 *  and avatar-files/ into files/, the only place GET /files/* serves from.
 *  Same key mapping as backend/scripts/copy-files-to-r2.mjs did for
 *  production, including a thumbnail copied from the full image for a
 *  cover that never had one. */
export function migrateLegacyFiles(directory = devDataDir) {
  const files = join(directory, "files");
  const covers = join(directory, "covers-files");
  if (existsSync(covers)) {
    const names = new Set(readdirSync(covers));
    for (const name of names) {
      const full = /^([0-9a-f-]{36})\.webp$/.exec(name);
      const thumb = full && `${full[1]}-thumb.webp`;
      if (thumb && !names.has(thumb) && !existsSync(join(files, "covers", thumb))) {
        mkdirSync(join(files, "covers"), { recursive: true });
        copyFileSync(join(covers, name), join(files, "covers", thumb));
      }
      moveFile(join(covers, name), join(files, "covers", name));
    }
    rmSync(covers, { recursive: true });
  }
  for (const [legacy, kind] of [["gallery-files", "gallery"], ["avatar-files", "avatars"]]) {
    const source = join(directory, legacy);
    if (!existsSync(source)) continue;
    for (const user of readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const name of readdirSync(join(source, user.name))) moveFile(join(source, user.name, name), join(files, kind, name));
    }
    rmSync(source, { recursive: true });
  }
}
