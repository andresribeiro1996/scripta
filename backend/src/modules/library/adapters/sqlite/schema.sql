-- Owned exclusively by this adapter, in this module's own SQLite file —
-- deliberately separate from the auth module's database (see
-- modules/auth/adapters/sqlite/schema.sql for why: each module's storage
-- is independent, so there's no real database-level foreign key from
-- user_id back to auth's users table here — it's just an opaque string,
-- trusted because it came from a token the auth module already verified.
--
-- NORMALISED, as of the multi-user rework. This module used to store the
-- whole library as ONE JSON blob per user (`library_documents`, still
-- present below and still migrated from — see migrateFromDocuments.ts).
-- That shape rewrote every book, group and mural on every change, which
-- capped a save at Fastify's 1 MB body limit, blocked the event loop on
-- large libraries, and made per-entity writes impossible. See
-- docs/DEPLOYMENT-PLAN.md.
--
-- WHY THIS IS A HYBRID and not fully column-per-field: a book record has
-- no fixed schema. exporter/ emits whatever columns the Kobo device
-- actually had (see its existing_columns()), a Goodreads CSV import
-- carries a different set again, and the app adds its own `_`-prefixed
-- fields (_coverUrl, _order, _style). So the columns below are exactly
-- the ones the app queries, sorts, or joins on; everything else rides in
-- `data` as JSON. Normalising the STRUCTURE is what removes the
-- rewrite-everything problem — the leaf attributes genuinely have no
-- fixed shape.

-- Per-user library-level settings: the user-given library name, the
-- importer provenance fields, and the card-style preferences. One small
-- row per user, so writing it never touches a single book.
--
-- `version` is the whole account's library version, bumped on every
-- write through this module. It exists for optimistic concurrency (slice
-- 2: reject a stale write with 409 instead of silently clobbering the
-- user's other device — see docs/DEPLOYMENT-PLAN.md phase 2). Nothing
-- enforces it yet; it is recorded from the start so that when the check
-- lands there is already a meaningful value to check against.
CREATE TABLE IF NOT EXISTS library_settings (
  user_id        TEXT PRIMARY KEY,
  name           TEXT,             -- user-given library name; NULL until they set one
  source         TEXT,             -- importer provenance, e.g. "kobo-export"
  schema_version INTEGER,          -- the IMPORT format's version, not this table's
  style          TEXT,             -- LibraryStyleSettings as JSON; NULL until customised
  -- Top-level document fields with no column of their own, kept verbatim
  -- so a field a future importer adds survives a round trip without a
  -- schema change. "{}" for most libraries.
  extra          TEXT NOT NULL DEFAULT '{}',
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per book per user.
--
-- `book_key` is the app's own cross-source identity for a book —
-- "isbn:<isbn>", falling back to "ta:<title>|<author>" (see
-- frontend/src/lib/merge.ts's bookKey()). It is what groups and mural
-- blocks reference, NOT `id`, because a group has to keep meaning the
-- same thing across a re-import and no source-native id is stable across
-- sources. That makes (user_id, book_key) the real natural key here.
--
-- `sort_position` is the app-managed `_order` field lifted out of the
-- JSON so ORDER BY can use it (see frontend/src/lib/libraryOrder.ts).
-- NULL means "never explicitly ordered", which sorts last.
CREATE TABLE IF NOT EXISTS books (
  user_id       TEXT NOT NULL,
  book_key      TEXT NOT NULL,
  title         TEXT,
  author        TEXT,             -- the source's `Attribution` field
  isbn          TEXT,             -- normalised, digits only; NULL when the book has none
  series        TEXT,             -- what deriveSeriesGroups() auto-seeds series from
  sort_position INTEGER,          -- `_order`; NULL sorts last
  data          TEXT NOT NULL,    -- the full book record as JSON, minus `highlights`
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, book_key)
);

CREATE INDEX IF NOT EXISTS idx_books_user_order ON books(user_id, sort_position);
CREATE INDEX IF NOT EXISTS idx_books_user_series ON books(user_id, series);

-- Highlights and annotations, split out of the book record.
--
-- This is the split that actually shrinks the write path: highlights are
-- the bulk of a large library's payload, and they change independently of
-- the book row they hang off.
--
-- `bookmark_id` is the source's own BookmarkID. frontend/src/lib/merge.ts's
-- unionHighlights() already de-duplicates on it across repeated imports
-- from the same source, so it is a genuine natural key — the UNIQUE
-- constraint below moves that invariant into the database rather than
-- leaving it to the importer to remember.
CREATE TABLE IF NOT EXISTS highlights (
  user_id     TEXT NOT NULL,
  book_key    TEXT NOT NULL,
  bookmark_id TEXT NOT NULL,
  data        TEXT NOT NULL,    -- the full highlight record as JSON
  position    INTEGER NOT NULL, -- preserves the order the import supplied
  PRIMARY KEY (user_id, book_key, bookmark_id)
);

CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_key, position);

-- Series and collections — the same underlying concept, distinguished by
-- `type` (see frontend/src/lib/groups.ts). Series are auto-seeded from
-- each book's own series field; collections only ever come from the user.
-- (user_id, id) is the primary key, NOT id alone. Group ids are generated
-- CLIENT-side (frontend/src/lib/groups.ts's newGroupId), so they are not
-- trustworthy as a global identifier: with a bare `id PRIMARY KEY`, one
-- account saving a group whose id collided with another account's would
-- hit ON CONFLICT and overwrite that other account's row. Scoping the key
-- to the owner makes a collision between two users impossible rather than
-- merely unlikely — and means a chosen id can never address someone
-- else's data. Same reasoning for murals and mural_blocks below.
CREATE TABLE IF NOT EXISTS groups (
  user_id    TEXT NOT NULL,
  id         TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('series', 'collection')),
  name       TEXT NOT NULL,
  style      TEXT,             -- PerCardStyle as JSON; NULL means "inherit". Series only.
  position   INTEGER NOT NULL, -- preserves the order the group list was saved in
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_groups_user ON groups(user_id, position);

-- A group's members, ordered. References books by book_key rather than by
-- a row id, for the reason given on books.book_key above.
--
-- No foreign key to books(user_id, book_key): a group is allowed to
-- reference a book that isn't in the library right now. That's the
-- existing frontend behaviour — bookKeys survive a book being removed and
-- re-imported — and enforcing referential integrity here would silently
-- drop those members instead.
CREATE TABLE IF NOT EXISTS group_books (
  user_id  TEXT NOT NULL,
  group_id TEXT NOT NULL,
  book_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id, book_key),
  FOREIGN KEY (user_id, group_id) REFERENCES groups(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_group_books_group ON group_books(user_id, group_id, position);

-- Freeform dashboards (see frontend/src/lib/murals.ts).
CREATE TABLE IF NOT EXISTS murals (
  user_id         TEXT NOT NULL,
  id              TEXT NOT NULL,
  name            TEXT NOT NULL,
  cover_image_id  TEXT,           -- a gallery image id; present/absent together with the URL below
  cover_image_url TEXT,
  position        INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_murals_user ON murals(user_id, position);

-- One row per block on a mural's canvas. This is the row that makes a
-- mural drag cheap: MuralEditorPage's handleLayoutChange currently
-- rewrites the entire library on every react-grid-layout drop, and with
-- this table it only ever needs to touch the one block that moved.
--
-- Layout is columns (it is written on every drag, and slice 2 updates it
-- alone), but the block's CONTENT stays JSON in `data` — MuralBlock is a
-- ten-variant discriminated union where each variant carries different
-- fields (a tierlist's tiers, a shelf's bookKeys, a quote's highlightId),
-- so a column-per-field table would be mostly NULLs. `type` is lifted out
-- because it is the discriminant.
CREATE TABLE IF NOT EXISTS mural_blocks (
  user_id  TEXT NOT NULL,
  id       TEXT NOT NULL,
  mural_id TEXT NOT NULL,
  type     TEXT NOT NULL,
  x        INTEGER NOT NULL,
  y        INTEGER NOT NULL,
  w        INTEGER NOT NULL,
  h        INTEGER NOT NULL,
  position INTEGER NOT NULL,
  data     TEXT NOT NULL,    -- the block's variant fields + style, as JSON
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, mural_id) REFERENCES murals(user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mural_blocks_mural ON mural_blocks(user_id, mural_id, position);

-- The pre-normalisation table. Deliberately still created and NOT dropped
-- by the migration: it is the rollback path and the backup of last resort
-- for anyone whose data was written before the rework. Nothing reads it
-- except migrateFromDocuments.ts. Slice 3 retires it, once the per-entity
-- API has been live long enough to trust.
CREATE TABLE IF NOT EXISTS library_documents (
  user_id     TEXT PRIMARY KEY,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Which one-off migrations have already run, so they are not re-applied
-- on every boot. Keyed by a stable name, not an ordinal, so migrations
-- can be added out of order.
CREATE TABLE IF NOT EXISTS schema_migrations (
  name    TEXT PRIMARY KEY,
  ran_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
