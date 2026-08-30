-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as auth's/library's/gallery's
-- schema.sql: no real foreign key back to auth's users table, user_id is
-- just an opaque string trusted because it came from a token auth already
-- verified.
--
-- share_token is a real UNIQUE column from the start (this is a brand-new
-- table, unlike library's embedded-blob murals, which have no id at all
-- yet) — SQLite treats multiple NULLs as distinct, so unshared rows
-- (share_token IS NULL) never collide with each other. Nothing in this
-- module sets it yet: Task 4 adds the share/unshare routes that do.

CREATE TABLE IF NOT EXISTS murals (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  name             TEXT NOT NULL,
  blocks           TEXT NOT NULL DEFAULT '[]',
  cover_image_id   TEXT,
  cover_image_url  TEXT,
  share_token      TEXT UNIQUE,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_murals_user_id ON murals(user_id);
