-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as auth's and library's schema.sql:
-- no real foreign key back to auth's users table, user_id is just an
-- opaque string trusted because it came from a token auth already
-- verified.

CREATE TABLE IF NOT EXISTS gallery_images (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  filename    TEXT NOT NULL,   -- original upload name, display only — never used as a path
  mime_type   TEXT NOT NULL,   -- of the re-encoded file actually on disk, not the original upload
  extension   TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_user_id ON gallery_images(user_id);
