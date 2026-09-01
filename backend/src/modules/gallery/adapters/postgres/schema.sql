-- The Postgres counterpart of adapters/sqlite/schema.sql.
--
-- No foreign key to auth's users table even though both now live in the
-- same database: user_id stays an opaque string trusted because it came
-- from a token the auth module already verified. Adding the constraint
-- here would couple two modules' schemas together, which is precisely the
-- boundary the one-file-per-module convention existed to keep.
CREATE TABLE IF NOT EXISTS gallery_images (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  filename    TEXT NOT NULL,   -- original upload name, display only — never used as a path
  mime_type   TEXT NOT NULL,   -- of the re-encoded file actually stored, not the original upload
  extension   TEXT NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  byte_size   BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gallery_images_user_id ON gallery_images (user_id);
