-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql.
--
-- GLOBAL, not per-account, unlike gallery_images — there's no user_id
-- column at all. The same public book has the same cover for every
-- account on this install, so one resolved-and-cached row serves
-- everyone; the first account to view a given book resolves it for
-- every account after.
--
-- cache_key is "isbn:<isbn>" or "kobo:<imageId>" — the only two
-- identifiers stable/global enough to trust as a permanent cache key (a
-- fuzzy title+author match is NOT cached here at all — see service.ts's
-- own comment for why trusting a "probably this book" guess as a
-- forever-shared global cache entry would be a real correctness risk the
-- ISBN/imageId-backed entries don't have).
CREATE TABLE IF NOT EXISTS cover_cache (
  id          TEXT PRIMARY KEY,
  cache_key   TEXT NOT NULL UNIQUE,
  source      TEXT NOT NULL,   -- which resolver found it: "kobo" | "openlibrary" | "google" | "hardcover"
  mime_type   TEXT NOT NULL,   -- of the re-encoded file actually on disk, not whatever the source served
  extension   TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
