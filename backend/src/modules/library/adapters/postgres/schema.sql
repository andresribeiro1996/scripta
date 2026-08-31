-- The Postgres counterpart of adapters/sqlite/schema.sql. Same entities,
-- same keys, same reasoning — read that file for why the design is what
-- it is; this file only notes where Postgres differs.
--
-- Why a second schema rather than one portable one: the two dialects
-- disagree on enough (JSONB vs TEXT, TIMESTAMPTZ vs ISO strings, upsert
-- syntax details) that a lowest-common-denominator schema would give up
-- exactly the things worth having in Postgres. The PORT is what's shared
-- (domain/ports.ts); the SQL is not, and that is the point of the
-- adapter split.

CREATE TABLE IF NOT EXISTS library_settings (
  user_id        TEXT PRIMARY KEY,
  name           TEXT,
  source         TEXT,
  schema_version INTEGER,
  -- JSONB rather than TEXT: these are queryable here, and Postgres
  -- validates them on write instead of silently storing a malformed blob.
  style          JSONB,
  extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  user_id       TEXT NOT NULL,
  book_key      TEXT NOT NULL,
  title         TEXT,
  author        TEXT,
  isbn          TEXT,
  series        TEXT,
  sort_position INTEGER,
  data          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_key)
);

-- NULLS LAST matches the SQLite adapter's `sort_position IS NULL,
-- sort_position` ordering: a book that has never been explicitly ordered
-- sorts after every book that has.
CREATE INDEX IF NOT EXISTS idx_books_user_order ON books (user_id, sort_position NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_books_user_series ON books (user_id, series);

CREATE TABLE IF NOT EXISTS highlights (
  user_id     TEXT NOT NULL,
  book_key    TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  data        JSONB NOT NULL,
  position    INTEGER NOT NULL,
  PRIMARY KEY (user_id, book_key, bookmark_id)
);

CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights (user_id, book_key, position);

-- (user_id, id), never id alone — these ids are generated client-side, so
-- one account could otherwise address (and overwrite) another's rows. See
-- the SQLite schema's own note; this was a real bug, not a hypothetical.
CREATE TABLE IF NOT EXISTS groups (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('series', 'collection')),
  name       TEXT NOT NULL,
  style      JSONB,
  position   INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_groups_user ON groups (user_id, position);

CREATE TABLE IF NOT EXISTS group_books (
  user_id  TEXT NOT NULL,
  group_id TEXT NOT NULL,
  book_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id, book_key),
  FOREIGN KEY (user_id, group_id) REFERENCES groups (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_group_books_group ON group_books (user_id, group_id, position);

CREATE TABLE IF NOT EXISTS murals (
  user_id         TEXT NOT NULL,
  id              TEXT NOT NULL,
  name            TEXT NOT NULL,
  cover_image_id  TEXT,
  cover_image_url TEXT,
  position        INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_murals_user ON murals (user_id, position);

CREATE TABLE IF NOT EXISTS mural_blocks (
  user_id  TEXT NOT NULL,
  id       TEXT NOT NULL,
  mural_id TEXT NOT NULL,
  type     TEXT NOT NULL,
  x        INTEGER NOT NULL,
  y        INTEGER NOT NULL,
  w        INTEGER NOT NULL,
  h        INTEGER NOT NULL,
  position INTEGER NOT NULL,
  data     JSONB NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, mural_id) REFERENCES murals (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mural_blocks_mural ON mural_blocks (user_id, mural_id, position);

-- No `library_documents` here. That table is the pre-normalisation blob
-- and exists only in SQLite deployments as a rollback path; a Postgres
-- deployment is either brand new or arrives via scripts/sqlite-to-postgres.mjs,
-- which reads the already-normalised entities. Nothing would ever write it.

CREATE TABLE IF NOT EXISTS schema_migrations (
  name   TEXT PRIMARY KEY,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
