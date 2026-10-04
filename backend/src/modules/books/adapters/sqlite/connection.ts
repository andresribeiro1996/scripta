// Opens (and migrates) this module's own SQLite database — mirrors
// modules/gallery/adapters/sqlite/connection.ts exactly.

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { MIN_GOOD_WIDTH } from "../../domain/constants.js";
import { catalogTitleKey } from "../../domain/normalize.js";

const adapterDir = dirname(fileURLToPath(import.meta.url));

const LEGACY_CHECKED_AT = "1970-01-01T00:00:00.000Z";

interface LegacyCoverRow {
  id: string;
  cache_key: string;
  source: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

export function applyBooksMigrations(db: DatabaseSync): void {
  db.exec(readFileSync(`${adapterDir}/books.sql`, "utf8"));
  const columns = db.prepare("PRAGMA table_info(books)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "data_sources")) db.exec("ALTER TABLE books ADD COLUMN data_sources TEXT NOT NULL DEFAULT '[]'");
  if (!columns.some((column) => column.name === "cover_upgrade_wanted_at")) db.exec("ALTER TABLE books ADD COLUMN cover_upgrade_wanted_at TEXT");
  if (!columns.some((column) => column.name === "apple_checked_at")) db.exec("ALTER TABLE books ADD COLUMN apple_checked_at TEXT");
  if (!columns.some((column) => column.name === "ol_work_key")) db.exec("ALTER TABLE books ADD COLUMN ol_work_key TEXT");
  if (!columns.some((column) => column.name === "publisher_url")) db.exec("ALTER TABLE books ADD COLUMN publisher_url TEXT");
  if (!columns.some((column) => column.name === "created_by")) db.exec("ALTER TABLE books ADD COLUMN created_by TEXT");
  if (!columns.some((column) => column.name === "pages")) db.exec("ALTER TABLE books ADD COLUMN pages INTEGER");
  if (!columns.some((column) => column.name === "translator")) db.exec("ALTER TABLE books ADD COLUMN translator TEXT");
  if (!columns.some((column) => column.name === "summary_source")) db.exec("ALTER TABLE books ADD COLUMN summary_source TEXT");
  if (!columns.some((column) => column.name === "work_id")) db.exec("ALTER TABLE books ADD COLUMN work_id TEXT REFERENCES works(id)");
  if (!columns.some((column) => column.name === "language")) db.exec("ALTER TABLE books ADD COLUMN language TEXT");
  if (!columns.some((column) => column.name === "work_checked_at")) db.exec("ALTER TABLE books ADD COLUMN work_checked_at TEXT");
  if (!columns.some((column) => column.name === "title_key")) db.exec("ALTER TABLE books ADD COLUMN title_key TEXT");
  if (!columns.some((column) => column.name === "title_group_blocked_at")) db.exec("ALTER TABLE books ADD COLUMN title_group_blocked_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_work ON books(work_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_books_title_key ON books(title_key)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_works_merged_into ON works(merged_into)");
  const imageColumns = db.prepare("PRAGMA table_info(cover_images)").all() as Array<{ name: string }>;
  if (!imageColumns.some((column) => column.name === "origin")) db.exec("ALTER TABLE cover_images ADD COLUMN origin TEXT");
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cover_cache'`).get();
  if (legacy) {
    const rows = db.prepare(`SELECT id, cache_key, source, width, height, byte_size, created_at FROM cover_cache`).all() as unknown as LegacyCoverRow[];
    const insertBook = db.prepare(`
      INSERT INTO books (id, title, author, isbn, cover_image_id, cover_status, cover_checked_at, created_at)
      VALUES (?, '', '', ?, ?, ?, ?, ?)
    `);
    const insertKey = db.prepare(`INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)`);
    const insertImage = db.prepare(`
      INSERT OR IGNORE INTO cover_images (id, book_id, source, source_url, width, height, byte_size, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
    `);

    db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (!row.cache_key.startsWith("isbn:")) continue;
        const bookId = randomUUID();
        const status = row.width >= MIN_GOOD_WIDTH ? "good" : "low_res";
        insertBook.run(bookId, row.cache_key.slice("isbn:".length), row.id, status, LEGACY_CHECKED_AT, row.created_at);
        insertKey.run(row.cache_key, bookId);
        insertImage.run(row.id, bookId, row.source, row.width, row.height, row.byte_size, row.created_at);
      }
      db.exec("DROP TABLE cover_cache");
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
  backfillTitleKeys(db);
}

function backfillTitleKeys(db: DatabaseSync): void {
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version >= 1) return;
  const rows = db.prepare("SELECT id, title, author FROM books WHERE title != '' ORDER BY created_at ASC").all() as Array<{ id: string; title: string; author: string }>;
  const insertKey = db.prepare("INSERT OR IGNORE INTO book_keys (key, book_id) VALUES (?, ?)");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const key = catalogTitleKey(row.title, row.author);
      if (key) insertKey.run(key, row.id);
    }
    db.exec("PRAGMA user_version = 1");
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function openBooksDb(): DatabaseSync {
  mkdirSync(dirname(env.COVERS_DB_PATH), { recursive: true });
  const db = new DatabaseSync(env.COVERS_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  applyBooksMigrations(db);
  return db;
}
