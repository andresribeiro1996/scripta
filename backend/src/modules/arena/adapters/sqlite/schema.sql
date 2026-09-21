-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql.
-- Unlike gallery/library (per-account) and like covers (global-ish), a
-- tournament is CREATED by one account (owner_user_id, an opaque string
-- from a verified JWT — no real FK to auth's users table, same
-- convention as every other module) but its slots/duels/votes are
-- PUBLIC: anyone with the tournament id can read the bracket and vote,
-- no account required.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tournaments (
  id                       TEXT PRIMARY KEY,
  owner_user_id            TEXT NOT NULL,
  name                     TEXT NOT NULL,
  bracket_size             INTEGER NOT NULL,
  round_duration_minutes   INTEGER NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'seeding', -- 'seeding' | 'active' | 'completed'
  current_round            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tournaments_owner ON tournaments(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);

-- The seeded pool, one row per bracket slot — title/author/cover are a
-- SNAPSHOT copied in at seed time (see domain/types.ts's own comment).
CREATE TABLE IF NOT EXISTS tournament_slots (
  tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  slot_index     INTEGER NOT NULL,
  book_key       TEXT NOT NULL,
  title          TEXT NOT NULL,
  author         TEXT NOT NULL,
  cover_url      TEXT,
  PRIMARY KEY (tournament_id, slot_index)
);

-- Both books are denormalized directly onto the duel row rather than
-- joined from tournament_slots — reading or voting on one duel should
-- never need a join.
CREATE TABLE IF NOT EXISTS duels (
  id              TEXT PRIMARY KEY,
  tournament_id   TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number    INTEGER NOT NULL,
  duel_index      INTEGER NOT NULL,
  book_a_key      TEXT NOT NULL,
  book_a_title    TEXT NOT NULL,
  book_a_author   TEXT NOT NULL,
  book_a_cover    TEXT,
  book_b_key      TEXT NOT NULL,
  book_b_title    TEXT NOT NULL,
  book_b_author   TEXT NOT NULL,
  book_b_cover    TEXT,
  winner_key      TEXT,
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'tied_pending_tiebreak' | 'settled'
  opens_at        TEXT NOT NULL,
  closes_at       TEXT NOT NULL,
  settled_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_duels_tournament_round ON duels(tournament_id, round_number);
-- Backs the scheduler's own sweep — see sqliteArenaRepository.ts's
-- findActiveDuelsPastDeadline.
CREATE INDEX IF NOT EXISTS idx_duels_status_closes_at ON duels(status, closes_at);

-- voter_token is a random UUID the frontend generates once per browser
-- and stores in localStorage — this is what makes "anyone can vote, no
-- account needed" possible at all. The UNIQUE constraint is what makes a
-- vote lock in once cast (INSERT OR IGNORE in the adapter, same
-- race-safe idiom modules/covers already uses for first-write-wins).
--
-- voter_user_id is the signed-in counterpart: NULL for a truly anonymous
-- vote, the account id once someone votes with a session. Voting signed
-- in also backfills it onto every earlier vote cast under the same
-- voter_token, so the per-device history folds into the account.
CREATE TABLE IF NOT EXISTS votes (
  id            TEXT PRIMARY KEY,
  duel_id       TEXT NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  voter_token   TEXT NOT NULL,
  voter_user_id TEXT,
  book_key      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (duel_id, voter_token)
);

CREATE INDEX IF NOT EXISTS idx_votes_duel_book ON votes(duel_id, book_key);
-- Backs "tournaments I voted in" (listVotedByUser) — partial, so the
-- anonymous majority of rows stays out of the index.
CREATE INDEX IF NOT EXISTS idx_votes_voter_user ON votes(voter_user_id) WHERE voter_user_id IS NOT NULL;
-- One vote per ACCOUNT per duel, enforced for signed-in voters: without
-- this, the UNIQUE(duel_id, voter_token) above was the only brake, and a
-- signed-in voter minting a fresh client token per request cast a fresh
-- counted vote each time. Partial (voter_user_id IS NOT NULL) so the
-- anonymous one-vote-per-browser-token rule stays exactly as it was;
-- INSERT OR IGNORE in the adapter folds this conflict into the same
-- "already voted" path as the token one. connection.ts's boot migration
-- dedupes any pre-existing multi-votes before creating the index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_duel_user ON votes(duel_id, voter_user_id) WHERE voter_user_id IS NOT NULL;
