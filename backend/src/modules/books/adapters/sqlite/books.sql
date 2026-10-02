CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  ol_work_key  TEXT UNIQUE,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  merged_into  TEXT REFERENCES works(id),
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  author              TEXT NOT NULL,
  year                INTEGER,
  publisher           TEXT,
  isbn                TEXT,
  ol_cover_id         INTEGER,
  summary             TEXT,
  rating              REAL,
  rating_count        INTEGER NOT NULL DEFAULT 0,
  genres              TEXT NOT NULL DEFAULT '[]',
  data_sources        TEXT NOT NULL DEFAULT '[]',
  summary_source      TEXT,
  pages               INTEGER,
  translator          TEXT,
  source_url          TEXT,
  details_status      TEXT,
  details_checked_at  TEXT,
  cover_image_id      TEXT,
  cover_status        TEXT,
  cover_checked_at    TEXT,
  cover_upgrade_wanted_at TEXT,
  ol_work_key         TEXT,
  publisher_url       TEXT,
  created_by          TEXT,
  work_id             TEXT REFERENCES works(id),
  language            TEXT,
  work_checked_at     TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS book_keys (
  key      TEXT PRIMARY KEY,
  book_id  TEXT NOT NULL REFERENCES books(id)
);

CREATE TABLE IF NOT EXISTS cover_images (
  id          TEXT PRIMARY KEY,
  book_id     TEXT NOT NULL REFERENCES books(id),
  source      TEXT NOT NULL,
  source_url  TEXT,
  origin      TEXT,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cover_rejections (
  book_id     TEXT NOT NULL REFERENCES books(id),
  source_url  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (book_id, source_url)
);

CREATE VIRTUAL TABLE IF NOT EXISTS books_fts USING fts5(
  book_id UNINDEXED,
  title,
  author,
  tokenize = 'unicode61 remove_diacritics 2'
);
