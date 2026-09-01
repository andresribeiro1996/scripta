-- The Postgres counterpart of adapters/sqlite/schema.sql. Same table,
-- same reasoning — read that file for why cache_key is what it is.
--
-- GLOBAL, not per-account: the same public book has the same cover for
-- every account on this install, so one resolved row serves everyone.
CREATE TABLE IF NOT EXISTS cover_cache (
  id          TEXT PRIMARY KEY,
  cache_key   TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,   -- "kobo" | "openlibrary" | "google" | "hardcover"
  mime_type   TEXT NOT NULL,
  extension   TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
