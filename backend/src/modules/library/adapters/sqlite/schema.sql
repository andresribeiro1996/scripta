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
