-- Owned exclusively by this adapter, in this module's own SQLite file —
-- deliberately separate from the auth module's database (see
-- modules/auth/adapters/sqlite/schema.sql for why: each module's storage
-- is independent, so there's no real database-level foreign key from
-- user_id back to auth's users table here — it's just an opaque string,
-- trusted because it came from a token the auth module already verified.

CREATE TABLE IF NOT EXISTS library_documents (
  user_id     TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS library_derived (
  user_id           TEXT PRIMARY KEY,
  glyph             TEXT,
  source_updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_match_keys (
  user_id  TEXT NOT NULL,
  key      TEXT NOT NULL,
  book_ref INTEGER NOT NULL,
  title    TEXT NOT NULL,
  author   TEXT NOT NULL,
  isbn     TEXT,
  cover    TEXT,
  PRIMARY KEY (user_id, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_library_match_keys_key ON library_match_keys (key, user_id);

CREATE TABLE IF NOT EXISTS library_books (
  user_id       TEXT NOT NULL,
  position      INTEGER NOT NULL,
  book_key      TEXT NOT NULL,
  title         TEXT,
  author        TEXT,
  isbn          TEXT,
  image_id      TEXT,
  read_status   REAL,
  series_number REAL,
  sort_order    REAL,
  cover_url     TEXT,
  finished_year INTEGER,
  row_hash      TEXT NOT NULL,
  PRIMARY KEY (user_id, position)
);
CREATE INDEX IF NOT EXISTS idx_library_books_key ON library_books (user_id, book_key);
CREATE INDEX IF NOT EXISTS idx_library_books_status ON library_books (user_id, read_status);

CREATE TABLE IF NOT EXISTS library_highlights (
  user_id      TEXT NOT NULL,
  position     INTEGER NOT NULL,
  highlight_id TEXT NOT NULL,
  text         TEXT,
  annotation   TEXT,
  PRIMARY KEY (user_id, position, highlight_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS library_summary (
  user_id           TEXT PRIMARY KEY,
  meta              TEXT,
  reader_card       TEXT,
  shelf_theme       TEXT,
  total_books       INTEGER NOT NULL,
  finished_count    INTEGER NOT NULL,
  in_progress_count INTEGER NOT NULL,
  total_highlights  INTEGER NOT NULL,
  source_updated_at TEXT NOT NULL,
  rows_version      INTEGER NOT NULL
);
