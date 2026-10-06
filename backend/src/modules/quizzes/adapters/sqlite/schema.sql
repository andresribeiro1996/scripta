-- Owned exclusively by this adapter, in this module's own SQLite file —
-- same module-isolation convention as every other module's schema.sql:
-- no real foreign key back to auth's users table; owner_user_id is an
-- opaque string auth already verified (same as tierlists/arena).

CREATE TABLE IF NOT EXISTS quizzes (
  id            TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  name          TEXT NOT NULL,
  data          TEXT NOT NULL DEFAULT '{}',
  -- NULL on a private quiz; set once when published and never rotated.
  vote_code     TEXT,
  play_open     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_quizzes_owner_user_id ON quizzes(owner_user_id);

-- Same inline-NULL treatment as tierlists: SQLite cannot ADD COLUMN with
-- a UNIQUE constraint, so the separate unique index enforces it on both
-- the fresh and migrated paths.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quizzes_vote_code ON quizzes(vote_code);

CREATE TABLE IF NOT EXISTS quiz_plays (
  id            TEXT PRIMARY KEY,
  quiz_id       TEXT NOT NULL,
  voter_user_id TEXT,
  player_name   TEXT,
  score         INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_quiz_plays_quiz ON quiz_plays(quiz_id);

-- One play per account per quiz, enforced by the database (a submitted
-- play is final — a player must not resubmit after seeing results).
-- Partial so anonymous plays (NULL voter) never collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_plays_one_per_voter
  ON quiz_plays(quiz_id, voter_user_id) WHERE voter_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quiz_play_answers (
  play_id      TEXT NOT NULL REFERENCES quiz_plays(id) ON DELETE CASCADE,
  quiz_id      TEXT NOT NULL,
  question_id  TEXT NOT NULL,
  choice_index INTEGER NOT NULL,
  correct      INTEGER NOT NULL,
  PRIMARY KEY (play_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_play_answers_quiz
  ON quiz_play_answers(quiz_id, question_id, choice_index);

CREATE TABLE IF NOT EXISTS quiz_works (
  quiz_id TEXT NOT NULL,
  work_id TEXT NOT NULL,
  PRIMARY KEY (quiz_id, work_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_works_work ON quiz_works(work_id);
