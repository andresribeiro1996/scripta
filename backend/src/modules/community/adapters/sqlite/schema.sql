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
CREATE INDEX IF NOT EXISTS idx_profiles_published_updated ON profiles(published, updated_at);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL,
  trace_id   TEXT,
  source     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_user_time ON events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_publication_ref_v2
  ON events(ref_type, ref_id)
  WHERE type IN ('tierlist_published', 'tournament_published', 'quiz_published');
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_user_type_ref
  ON events(user_id, type, ref_id)
  WHERE type IN ('voted_on', 'following', 'mural_published');

CREATE TABLE IF NOT EXISTS events_history (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  type       TEXT NOT NULL,
  ref_type   TEXT NOT NULL,
  ref_id     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL,
  trace_id   TEXT,
  source     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_history_user_time ON events_history(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_history_time ON events_history(created_at);
CREATE INDEX IF NOT EXISTS idx_events_history_publication_ref ON events_history(ref_type, ref_id)
  WHERE type IN ('tierlist_published', 'tournament_published', 'quiz_published');
CREATE INDEX IF NOT EXISTS idx_events_history_user_ref ON events_history(ref_id) WHERE ref_type = 'user';

CREATE TABLE IF NOT EXISTS feed_inbox (
  viewer_id  TEXT NOT NULL,
  created_at TEXT NOT NULL,
  event_id   TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  PRIMARY KEY (viewer_id, created_at, event_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_feed_inbox_author ON feed_inbox(author_id, viewer_id);
CREATE INDEX IF NOT EXISTS idx_feed_inbox_time ON feed_inbox(created_at);

CREATE TABLE IF NOT EXISTS activity_likes (
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_likes_user ON activity_likes(user_id);
CREATE TABLE IF NOT EXISTS activity_comments (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_comments_event ON activity_comments(event_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_comments_user ON activity_comments(user_id);
CREATE TABLE IF NOT EXISTS saved_content (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('tierlist', 'tournament', 'quiz', 'mural')),
  ref_id TEXT NOT NULL,
  owner_id TEXT,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (user_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_content_time ON saved_content(user_id, saved_at DESC, kind, ref_id);
CREATE TABLE IF NOT EXISTS top_shelf_recaps (month TEXT PRIMARY KEY, data TEXT NOT NULL, has_cards INTEGER NOT NULL, frozen_at TEXT NOT NULL);
