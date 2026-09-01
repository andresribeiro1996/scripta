-- The Postgres counterpart of adapters/sqlite/schema.sql. Same tables,
-- same constraints, same reasoning — read that file for why the design is
-- what it is; this one only notes where Postgres differs.
--
-- Shares one database with the other modules rather than having its own
-- file. See src/shared/postgres/pool.ts for what that does to the module
-- boundary.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  -- An alternate login identifier, not just cosmetic. NULL until set —
  -- required immediately for password signups, but a Google sign-in
  -- creates the account first and prompts for one right after. Postgres,
  -- like SQLite, allows multiple NULLs under a UNIQUE constraint, which
  -- is exactly what that needs.
  username      TEXT UNIQUE,
  password_hash TEXT,              -- NULL for accounts created via Google only
  google_id     TEXT UNIQUE,       -- NULL until/unless linked to a Google account
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Refresh tokens are stored hashed (sha256), never in plaintext — same
-- reasoning as password storage: a database leak shouldn't hand out
-- usable credentials. Each refresh rotates (old row revoked, new row
-- inserted) on use, so a stolen-and-replayed token is detectable.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);

-- Looked up on every token refresh, so it wants to be an index rather
-- than a scan. UNIQUE here where SQLite has a plain index: a hash
-- collision would mean two tokens authenticating the same session, and
-- the database is a better place to make that impossible than a comment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens (token_hash);
