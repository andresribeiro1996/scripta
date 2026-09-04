-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql:
-- no real foreign key back to auth's users table, owner_user_id is just
-- an opaque string trusted because it came from a token auth already
-- verified (same as modules/arena's tournaments).

CREATE TABLE IF NOT EXISTS tierlists (
  id             TEXT PRIMARY KEY,
  owner_user_id  TEXT NOT NULL,
  name           TEXT NOT NULL,
  data           TEXT NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlists_owner_user_id ON tierlists(owner_user_id);
