// Copies a SQLite deployment's data into Postgres, for every module that
// has a Postgres adapter — which is now all five.
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
// auth lives in its own SQLite file; --auth-sqlite points at it. Optional,
// so a deployment that only wants the library moved can omit it.
const authSqlitePath = arg("auth-sqlite");
const gallerySqlitePath = arg("gallery-sqlite");
const socialsSqlitePath = arg("socials-sqlite");
// `covers` is deliberately not offered: it is a cache keyed on public book
// identifiers, and every row re-resolves on next view. Copying it would
// carry clutter across for no recovery value.
const postgresUrl = arg("postgres") ?? process.env.DATABASE_URL;
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!sqlitePath || !postgresUrl) {
  console.error(
    "Usage: node --import tsx scripts/sqlite-to-postgres.mjs --sqlite <library.sqlite> [--auth-sqlite <auth.sqlite>] [--gallery-sqlite <gallery.sqlite>] [--socials-sqlite <socials.sqlite>] --postgres <url> [--dry-run] [--force]"
  );
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

// --- auth -----------------------------------------------------------------
//
// Rows are copied straight across rather than going through the
// repository port, because AuthRepository has no "insert this exact row"
// operation — createUser generates a fresh id, which would break every
// foreign key and every library row keyed on the old one. The columns are
// few and fixed, so a direct copy is honest here in a way it would not be
// for library's open-ended book records.
let authCopied = 0;
if (authSqlitePath) {
  const { readFileSync: readAuthSchema } = await import("node:fs");
  await pool.query(readAuthSchema(join(scriptDir, "../src/modules/auth/adapters/postgres/schema.sql"), "utf8"));

  const authDb = new DatabaseSync(authSqlitePath, { readOnly: true });
  const users = authDb.prepare("SELECT * FROM users").all();
  const tokens = authDb.prepare("SELECT * FROM refresh_tokens WHERE revoked_at IS NULL AND expires_at > ?").all(
    new Date().toISOString()
  );

  console.log(`\nauth: ${users.length} account(s), ${tokens.length} live refresh token(s) in ${authSqlitePath}`);

  if (!dryRun) {
    for (const user of users) {
      // ON CONFLICT DO NOTHING so a re-run is safe; --force is not offered
      // here because overwriting an account row is never the right repair.
      await pool.query(
        `INSERT INTO users (id, email, username, password_hash, google_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [user.id, user.email, user.username, user.password_hash, user.google_id, user.created_at]
      );
      authCopied++;
    }
    // Expired and revoked tokens are deliberately left behind: they grant
    // nothing, and carrying them over just imports clutter. Live ones are
    // copied so the migration doesn't sign everybody out.
    for (const token of tokens) {
      await pool.query(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [token.id, token.user_id, token.token_hash, token.expires_at, token.revoked_at, token.created_at]
      );
    }

    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
    if (rows[0].n < users.length) {
      failed.push(`auth: only ${rows[0].n} of ${users.length} accounts are present after the copy`);
    }
    console.log(`  copied ${authCopied} account(s) and ${tokens.length} live token(s)`);
  } else {
    console.log(`  would copy ${users.length} account(s) and ${tokens.length} live token(s)`);
  }

  authDb.close();
} else {
  console.log("\nauth: --auth-sqlite not given, skipping (accounts stay in SQLite)");
}

// --- gallery and socials --------------------------------------------------
//
// Row-for-row, same reasoning as auth: these ports have no "insert this
// exact row" operation, and regenerating ids would orphan every blob in
// object storage (which is keyed on the image id) and every mural block
// referencing an image.
//
// The blobs themselves are moved separately, by
// scripts/files-to-object-storage.mjs. Metadata without blobs renders
// broken images; blobs without metadata are invisible. Run both.
async function copyTable({ label, path, schemaPath, table, columns }) {
  if (!path) {
    console.log(`\n${label}: --${label}-sqlite not given, skipping`);
    return;
  }

  await pool.query(readFileSync(join(scriptDir, schemaPath), "utf8"));

  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(`SELECT * FROM ${table}`).all();
  console.log(`\n${label}: ${rows.length} row(s) in ${path}`);

  if (dryRun) {
    console.log(`  would copy ${rows.length} row(s)`);
    db.close();
    return;
  }

  const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
  for (const row of rows) {
    // DO NOTHING so a re-run is safe. A conflict here means the row is
    // already there, which is the desired end state either way.
    await pool.query(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      columns.map((column) => row[column])
    );
  }

  const { rows: counted } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`);
  if (counted[0].n < rows.length) {
    failed.push(`${label}: only ${counted[0].n} of ${rows.length} rows are present after the copy`);
  }
  console.log(`  copied ${rows.length} row(s)`);
  db.close();
}

await copyTable({
  label: "gallery",
  path: gallerySqlitePath,
  schemaPath: "../src/modules/gallery/adapters/postgres/schema.sql",
  table: "gallery_images",
  columns: ["id", "user_id", "filename", "mime_type", "extension", "width", "height", "byte_size", "created_at"]
});

await copyTable({
  label: "socials",
  path: socialsSqlitePath,
  schemaPath: "../src/modules/socials/adapters/postgres/schema.sql",
  table: "social_connections",
  columns: [
    "user_id",
    "provider",
    "handle",
    "provider_account_id",
    "access_token_enc",
    "refresh_token_enc",
    "expires_at",
    "connected_at"
  ]
});

console.log("\ncovers: skipped on purpose — it is a cache and re-resolves on next view.");
console.log("Blobs move separately: scripts/files-to-object-storage.mjs");

sqlite.close();
await pool.end();

console.log(`\n${dryRun ? "would copy" : "copied"} ${copied}, skipped ${skipped}, failed ${failed.length}`);
if (failed.length > 0) {
  console.error(`Failed accounts: ${failed.join(", ")}`);
  console.error("The SQLite file was not modified — fix the cause and re-run; copied accounts will be skipped.");
  process.exit(1);
}
