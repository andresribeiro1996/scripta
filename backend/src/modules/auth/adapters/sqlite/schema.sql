-- Owned exclusively by this adapter. No other module, and no other file
-- in this module outside adapters/sqlite/, may query these tables
-- directly — go through modules/auth's public interface (or, within this
-- module, the AuthRepository port) instead.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  username      TEXT UNIQUE,        -- an alternate login identifier, not just cosmetic.
                                     -- NULL until set — required immediately for
                                     -- password signups, but a Google sign-in creates
                                     -- the account first and prompts for one right
                                     -- after (SQLite's UNIQUE allows multiple NULLs,
                                     -- which is exactly what's needed here).
  password_hash TEXT,              -- NULL for accounts created via Google only
  google_id     TEXT UNIQUE,       -- NULL until/unless linked to a Google account
  avatar_id     TEXT UNIQUE,       -- NULL until a profile picture is uploaded; the
                                   -- id changes on every replacement, which doubles
                                   -- as the cache-buster for the immutable file route
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- UNIQUE as a separate index (not an inline column constraint) because
-- SQLite's ALTER TABLE ADD COLUMN can't add a UNIQUE column — the
-- boot-time migration in connection.ts adds avatar_id via ALTER, and this
-- statement then backfills the constraint identically for both fresh and
-- migrated databases.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_avatar_id ON users(avatar_id);

-- Refresh tokens are stored hashed (sha256), never in plaintext — the same
-- reasoning as password storage: a DB leak shouldn't hand out usable
-- credentials. Each refresh also rotates (old row revoked, new row
-- inserted) on use, so a stolen-and-replayed token is detectable.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
