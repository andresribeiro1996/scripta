-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql:
-- no real foreign key back to auth's users table, owner_user_id is just
-- an opaque string trusted because it came from a token auth already
-- verified (same as modules/arena's tournaments).

CREATE TABLE IF NOT EXISTS tierlists (
  id                 TEXT PRIMARY KEY,
  owner_user_id      TEXT NOT NULL,
  name               TEXT NOT NULL,
  data               TEXT NOT NULL DEFAULT '{}',
  -- NULL on an ordinary private tier list; set once when a community
  -- copy is created and never rotated. Deliberately NOT declared UNIQUE
  -- inline: SQLite cannot ADD COLUMN with a UNIQUE constraint, so the
  -- migration path in connection.ts could never match this. The separate
  -- unique index below is what enforces it on BOTH paths.
  vote_code          TEXT,
  vote_access        TEXT NOT NULL DEFAULT 'anonymous',
  voting_open        INTEGER NOT NULL DEFAULT 0,
  source_tierlist_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlists_owner_user_id ON tierlists(owner_user_id);

-- SQLite treats multiple NULLs as distinct, so every ordinary tier list
-- (vote_code IS NULL) coexists happily under a UNIQUE index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tierlists_vote_code ON tierlists(vote_code);

-- Partial, so listing the public directory never scans private tier lists.
CREATE INDEX IF NOT EXISTS idx_tierlists_public
  ON tierlists(created_at DESC) WHERE vote_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS tierlist_ballots (
  id            TEXT PRIMARY KEY,
  tierlist_id   TEXT NOT NULL,
  voter_user_id TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_tierlist_ballots_tierlist ON tierlist_ballots(tierlist_id);

-- One ballot per account per tier list, enforced by the database rather
-- than by handler logic. Partial so anonymous ballots (all NULL) never
-- collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tierlist_ballots_one_per_voter
  ON tierlist_ballots(tierlist_id, voter_user_id) WHERE voter_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tierlist_ballot_placements (
  ballot_id   TEXT NOT NULL REFERENCES tierlist_ballots(id) ON DELETE CASCADE,
  tierlist_id TEXT NOT NULL,
  book_key    TEXT NOT NULL,
  tier_id     TEXT NOT NULL,
  PRIMARY KEY (ballot_id, book_key)
);
CREATE INDEX IF NOT EXISTS idx_tierlist_placements_histogram
  ON tierlist_ballot_placements(tierlist_id, book_key, tier_id);
