// Takes a consistent, verified snapshot of everything this deployment
// stores, and optionally uploads it to object storage.
//
//   node --import tsx scripts/backup.mjs [--out DIR] [--upload] [--keep N]
//
//   --out DIR   where to write the snapshot (default ./backups)
//   --upload    also push it to S3_BUCKET under backups/<timestamp>/
//   --keep N    delete all but the newest N local snapshots (default 7)
//
// WHAT IS ACTUALLY AT RISK, which is more than it looks:
//
//   auth      SQLite  — accounts and refresh tokens. Losing this is losing
//                       every user, irrecoverably.
//   socials   SQLite  — platform tokens, encrypted with SOCIALS_ENCRYPTION_KEY.
//                       Useless without that key, so back the key up too,
//                       somewhere that is NOT this snapshot.
//   gallery   SQLite  — the metadata rows. The images themselves are either
//                       on disk or in the bucket, but without these rows
//                       nothing knows they exist.
//   covers    SQLite  — a cache. Genuinely disposable: it re-resolves.
//   library   SQLite or Postgres, depending on DATABASE_URL.
//
// Only `library` has a Postgres adapter today, so a deployment with
// DATABASE_URL set STILL has four SQLite files on local disk. That is the
// thing most likely to be misremembered when someone decides the volume is
// no longer needed.
//
// RESTORING: stop the app, put each .sqlite file back at its configured
// path (there are no -wal/-shm files to worry about — a snapshot is a
// single self-contained file), restore Postgres with `psql < library.sql`,
// and untar the blob directories if they are in the snapshot. Then start
// the app. Verified end to end in test/backup.test.ts.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

import { env, useObjectStorage } from "../src/config/env.ts";

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const outRoot = resolve(flag("out", "./backups"));
const upload = process.argv.includes("--upload");
const keep = Number(flag("keep", "7"));

// Sortable and filesystem-safe, so `ls` orders snapshots chronologically.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(outRoot, stamp);
mkdirSync(outDir, { recursive: true });

const manifest = { startedAt: new Date().toISOString(), entries: [] };
const problems = [];

/** SQLite databases this deployment actually uses. `library` is excluded
 *  when DATABASE_URL is set, because the live data is in Postgres then and
 *  the stale file would be a misleading thing to restore. */
const sqliteTargets = [
  ["auth", env.AUTH_DB_PATH],
  ["gallery", env.GALLERY_DB_PATH],
  ["covers", env.COVERS_DB_PATH],
  ["socials", env.SOCIALS_DB_PATH],
  ...(env.DATABASE_URL ? [] : [["library", env.LIBRARY_DB_PATH]])
];

// --- SQLite ---------------------------------------------------------------

for (const [name, path] of sqliteTargets) {
  if (!path || path === ":memory:" || !existsSync(path)) {
    console.log(`  skip   ${name} (${path || "unset"} — not a file on disk)`);
    continue;
  }

  const destination = join(outDir, `${name}.sqlite`);
  try {
    const source = new DatabaseSync(path, { readOnly: true });
    // The online backup API rather than copying the file: a plain copy of a
    // database being written to can capture a torn page, and copying
    // without the -wal alongside it silently loses the most recent writes.
    // This produces one self-contained, consistent file.
    await backup(source, destination);
    source.close();

    // A backup nobody has opened is a guess. Check it is readable, passes
    // SQLite's own integrity check, and has the tables in it.
    //
    // Opened read-WRITE, not read-only, so the journal mode can be taken
    // out of WAL first. The snapshot inherits WAL from its source, and
    // merely opening a WAL database creates -wal/-shm beside it — which
    // would make the snapshot three files that must travel together
    // instead of one, exactly the restore footgun this is meant to avoid.
    const check = new DatabaseSync(destination);
    check.exec("PRAGMA journal_mode = DELETE");
    const integrity = check.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`integrity_check said "${integrity}"`);
    const tables = check.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'").get().n;
    check.close();

    // Belt to that braces: if anything did leave sidecars, they are not
    // part of the snapshot.
    for (const sidecar of [`${destination}-wal`, `${destination}-shm`]) {
      if (existsSync(sidecar)) rmSync(sidecar, { force: true });
    }

    const bytes = statSync(destination).size;
    manifest.entries.push({ name, kind: "sqlite", source: path, file: `${name}.sqlite`, bytes, tables });
    console.log(`  ok     ${name}  ${bytes} bytes, ${tables} tables, integrity ok`);
  } catch (err) {
    problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`  FAILED ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Postgres -------------------------------------------------------------

if (env.DATABASE_URL) {
  const destination = join(outDir, "library.sql");
  try {
    // --no-owner/--no-acl so the dump restores into a differently-named
    // role, which is the normal case when restoring to a fresh database.
    execFileSync("pg_dump", ["--no-owner", "--no-acl", "--file", destination, env.DATABASE_URL], { stdio: "pipe" });
    const bytes = statSync(destination).size;
    manifest.entries.push({ name: "library", kind: "postgres", file: "library.sql", bytes });
    console.log(`  ok     library (postgres)  ${bytes} bytes`);
  } catch (err) {
    // Not fatal on its own: managed Postgres has point-in-time restore,
    // which is a better recovery story than a nightly dump. But it must be
    // reported rather than silently skipped, because "I have backups" and
    // "my provider has backups" are different claims.
    const reason = err instanceof Error ? err.message : String(err);
    problems.push(`library (postgres): ${reason}`);
    console.error(`  FAILED library (postgres): ${reason}`);
    console.error("         If pg_dump is not installed, rely on your provider's point-in-time restore — and verify it works.");
  }
}

// --- blobs ----------------------------------------------------------------

if (useObjectStorage) {
  // Copying the bucket into a local tarball would be the wrong shape: R2/S3
  // already replicate, and the real risk is an accidental delete, which a
  // nightly copy does not protect against either.
  console.log("  note   blobs are in object storage — enable BUCKET VERSIONING there rather than copying them here");
  manifest.entries.push({ name: "blobs", kind: "object-storage", bucket: env.S3_BUCKET, note: "not copied; enable bucket versioning" });
} else {
  for (const [name, path] of [
    ["gallery-files", env.GALLERY_STORAGE_PATH],
    ["covers-files", env.COVERS_STORAGE_PATH]
  ]) {
    if (!path || !existsSync(path)) {
      console.log(`  skip   ${name} (${path || "unset"} — nothing there)`);
      continue;
    }
    try {
      const destination = join(outDir, `${name}.tar.gz`);
      execFileSync("tar", ["-czf", destination, "-C", resolve(path, ".."), basename(resolve(path))], { stdio: "pipe" });
      const bytes = statSync(destination).size;
      manifest.entries.push({ name, kind: "files", source: path, file: `${name}.tar.gz`, bytes });
      console.log(`  ok     ${name}  ${bytes} bytes`);
    } catch (err) {
      problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`  FAILED ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// --- manifest -------------------------------------------------------------

manifest.finishedAt = new Date().toISOString();
manifest.problems = problems;
// Deliberately records what is NOT in here, so a future restore doesn't
// assume the snapshot is self-sufficient when it isn't.
manifest.notIncluded = [
  "SOCIALS_ENCRYPTION_KEY — without it every social token in socials.sqlite is undecryptable. Store it in a password manager, not here.",
  "JWT_ACCESS_SECRET / JWT_REFRESH_SECRET — restoring with different values signs every user out.",
  ...(useObjectStorage ? ["Gallery and cover blobs — they live in object storage; enable bucket versioning."] : [])
];
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

// --- upload ---------------------------------------------------------------

if (upload) {
  if (!useObjectStorage) {
    problems.push("--upload was given but S3_BUCKET is not set");
    console.error("  FAILED upload: S3_BUCKET is not set");
  } else {
    const { putObject } = await import("../src/shared/s3/client.ts");
    const { readFileSync } = await import("node:fs");
    // Only what the manifest lists, plus the manifest. Uploading whatever
    // happens to be in the directory would ship stray sidecars and make
    // the remote copy disagree with its own inventory.
    const files = [...manifest.entries.filter((entry) => entry.file).map((entry) => entry.file), "manifest.json"];
    for (const file of files) {
      await putObject(`backups/${stamp}/${file}`, readFileSync(join(outDir, file)), "application/octet-stream");
      console.log(`  sent   backups/${stamp}/${file}`);
    }
  }
}

// --- retention ------------------------------------------------------------

if (Number.isFinite(keep) && keep > 0) {
  const snapshots = readdirSync(outRoot)
    .filter((entry) => statSync(join(outRoot, entry)).isDirectory())
    .sort();
  for (const stale of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    rmSync(join(outRoot, stale), { recursive: true, force: true });
    console.log(`  pruned ${stale}`);
  }
}

console.log(`\nSnapshot: ${outDir}`);
if (problems.length > 0) {
  console.error(`${problems.length} problem(s): ${problems.join("; ")}`);
  // Non-zero so a scheduled run surfaces as a failure rather than a green
  // tick over a partial backup — the way silent backup rot usually starts.
  process.exit(1);
}
console.log("All targets captured and verified.");
