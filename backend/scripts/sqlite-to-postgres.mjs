// Copies every account's library from a SQLite deployment into Postgres.
//
//   node --import tsx scripts/sqlite-to-postgres.mjs \
//     --sqlite ./data/library.sqlite \
//     --postgres postgres://user:pass@host/db \
//     [--dry-run] [--force]
//
// Reads through the SQLite adapter and writes through the Postgres one,
// so both sides go via the same LibraryRepository port and the same
// document mapping the app itself uses — rather than a bespoke SQL-to-SQL
// copy that could drift from either. Every user is verified after writing
// by reassembling the document from Postgres and deep-comparing it to the
// one SQLite produced; a mismatch fails that user rather than being
// reported as success.
//
// NON-DESTRUCTIVE. The SQLite file is opened and never written to, so
// rolling back is "unset DATABASE_URL and redeploy". Re-running is safe:
// a user who already exists in Postgres is skipped unless --force.
//
// Run it with the app STOPPED. Writes that land in SQLite after its rows
// are read would not be copied, and the app has no dual-write mode.

import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { createSqliteLibraryRepository } from "../src/modules/library/adapters/sqlite/sqliteLibraryRepository.ts";
import { createPgLibraryRepository } from "../src/modules/library/adapters/postgres/pgLibraryRepository.ts";
import { toDocument } from "../src/modules/library/domain/document.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sqlitePath = arg("sqlite");
const postgresUrl = arg("postgres") ?? process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!sqlitePath || !postgresUrl) {
  console.error("Usage: node --import tsx scripts/sqlite-to-postgres.mjs --sqlite <path> --postgres <url> [--dry-run] [--force]");
  process.exit(1);
}

const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
const sqliteRepo = createSqliteLibraryRepository(sqlite);

const pool = new pg.Pool({
  connectionString: postgresUrl,
  ssl: process.env.DATABASE_SSL === "off" ? false : process.env.DATABASE_SSL === "no-verify" ? { rejectUnauthorized: false } : undefined
});

const pgSchema = readFileSync(join(scriptDir, "../src/modules/library/adapters/postgres/schema.sql"), "utf8");
await pool.query(pgSchema);

const pgRepo = createPgLibraryRepository(pool);

const userIds = sqlite
  .prepare("SELECT user_id FROM library_settings ORDER BY user_id")
  .all()
  .map((row) => String(row.user_id));

console.log(`${userIds.length} account${userIds.length === 1 ? "" : "s"} found in ${sqlitePath}`);
if (dryRun) console.log("--dry-run: nothing will be written\n");

let copied = 0;
let skipped = 0;
const failed = [];

for (const userId of userIds) {
  try {
    const existing = await pgRepo.getVersion(userId);
    if (existing !== undefined && !force) {
      console.log(`  skip   ${userId} (already in Postgres at version ${existing}; --force to overwrite)`);
      skipped++;
      continue;
    }

    const contents = await sqliteRepo.getContents(userId);
    if (!contents) {
      console.log(`  skip   ${userId} (no contents)`);
      skipped++;
      continue;
    }

    const books = contents.books.length;
    const highlights = contents.books.reduce((total, book) => total + book.highlights.length, 0);

    if (dryRun) {
      console.log(`  would copy ${userId}: ${books} books, ${highlights} highlights, ${contents.groups.length} groups, ${contents.murals.length} murals`);
      copied++;
      continue;
    }

    await pgRepo.replaceContents(userId, contents);

    // Verify by reassembling from the destination and comparing to what
    // the source produces. Copying rows without checking the result is
    // how a migration reports success and loses data anyway.
    const before = toDocument(contents);
    const after = toDocument(await pgRepo.getContents(userId));
    if (!isDeepStrictEqual(before, after)) {
      throw new Error("verification failed — the document read back from Postgres differs from the SQLite original");
    }

    console.log(`  copied ${userId}: ${books} books, ${highlights} highlights, ${contents.groups.length} groups, ${contents.murals.length} murals`);
    copied++;
  } catch (err) {
    console.error(`  FAILED ${userId}: ${err instanceof Error ? err.message : String(err)}`);
    failed.push(userId);
  }
}

sqlite.close();
await pool.end();

console.log(`\n${dryRun ? "would copy" : "copied"} ${copied}, skipped ${skipped}, failed ${failed.length}`);
if (failed.length > 0) {
  console.error(`Failed accounts: ${failed.join(", ")}`);
  console.error("The SQLite file was not modified — fix the cause and re-run; copied accounts will be skipped.");
  process.exit(1);
}
