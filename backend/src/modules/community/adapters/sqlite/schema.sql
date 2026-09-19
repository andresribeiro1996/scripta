CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS profiles (
  user_id      TEXT PRIMARY KEY,
  published    INTEGER NOT NULL DEFAULT 0,
  mural_id     TEXT,
  published_at TEXT,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_publication_ref
  ON events(ref_type, ref_id)
  WHERE type IN ('tierlist_published', 'tournament_published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_user_type_ref
  ON events(user_id, type, ref_id)
  WHERE type IN ('voted_on', 'following', 'mural_published');
