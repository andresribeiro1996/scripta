CREATE TABLE IF NOT EXISTS works (
  id           TEXT PRIMARY KEY,
  ol_work_key  TEXT UNIQUE,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  merged_into  TEXT REFERENCES works(id),
  created_at   TEXT NOT NULL,
  summary      TEXT,
  summary_hash TEXT
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
  apple_checked_at    TEXT,
  kobo_image_id       TEXT,
  ol_work_key         TEXT,
  publisher_url       TEXT,
  created_by          TEXT,
  work_id             TEXT REFERENCES works(id),
  language            TEXT,
  work_checked_at     TEXT,
  title_key           TEXT,
  title_group_blocked_at TEXT,
  genres_source TEXT,
  genres_confidence REAL,
  summary_hash        TEXT,
  original_title      TEXT,
  original_key        TEXT,
  original_whole_key  TEXT,
  retitle_wanted_at   TEXT,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS original_arrivals (title_key TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS original_key_version (version INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS genre_judgments (
  work_id    TEXT PRIMARY KEY,
  model      TEXT NOT NULL,
  genre      TEXT,
  confidence REAL NOT NULL,
  asked_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS typesafe_usage (
  day      TEXT NOT NULL,
  source   TEXT NOT NULL,
  requests INTEGER NOT NULL,
  PRIMARY KEY (day, source)
);

CREATE TABLE IF NOT EXISTS genre_rejections (
  work_id  TEXT PRIMARY KEY,
  status   INTEGER,
  reason   TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_at  TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS books_search (
  book_id TEXT PRIMARY KEY
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS synopsis_judgments (
  text_hash TEXT PRIMARY KEY,
  model     TEXT NOT NULL,
  usable    REAL NOT NULL,
  kind      TEXT NOT NULL,
  asked_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jev_rejections (
  task     TEXT NOT NULL,
  subject  TEXT NOT NULL,
  status   INTEGER,
  reason   TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_at  TEXT NOT NULL,
  PRIMARY KEY (task, subject)
);

CREATE TABLE IF NOT EXISTS work_merges (
  id                 INTEGER PRIMARY KEY,
  from_work          TEXT NOT NULL,
  into_work          TEXT NOT NULL,
  source             TEXT NOT NULL,
  confidence         REAL,
  moved_book_ids     TEXT NOT NULL,
  repointed_work_ids TEXT NOT NULL,
  merged_at          TEXT NOT NULL,
  undone_at          TEXT
);

CREATE TABLE IF NOT EXISTS harvest_cursors (
  feed    TEXT PRIMARY KEY,
  through TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_match_judgments (
  work_id      TEXT PRIMARY KEY,
  model        TEXT NOT NULL,
  into_work_id TEXT,
  confidence   REAL,
  asked_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_series (
  work_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  position   TEXT,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (work_id, name_key, source)
);

CREATE TABLE IF NOT EXISTS book_collections (
  book_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  name_key   TEXT NOT NULL,
  position   TEXT,
  source     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (book_id, name_key, source)
);

CREATE VIRTUAL TABLE IF NOT EXISTS series_fts USING fts5(
  work_id UNINDEXED,
  name,
  author,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS collections_fts USING fts5(
  book_id UNINDEXED,
  name,
  tokenize = 'unicode61 remove_diacritics 2'
);
