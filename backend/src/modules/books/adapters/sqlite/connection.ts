// Opens (and migrates) this module's own SQLite database — mirrors
// modules/gallery/adapters/sqlite/connection.ts exactly.

import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../../../../config/env.js";
import { MIN_GOOD_WIDTH } from "../../domain/constants.js";

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
  const legacy = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cover_cache'`).get();
  if (!legacy) return;

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

  db.exec("BEGIN");
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
    db.exec("ROLLBACK");
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
