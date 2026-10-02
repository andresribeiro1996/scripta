import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { CommunityRepository, CursorKeyset } from "../../domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "../../domain/types.js";

export function createSqliteCommunityRepository(db: DatabaseSync): CommunityRepository {
  const insertFollowStmt = db.prepare(`
    INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at)
    VALUES ($follower_id, $followee_id, $created_at)
  `);
  const deleteFollowStmt = db.prepare(`DELETE FROM follows WHERE follower_id = ? AND followee_id = ?`);
  const getFollowStmt = db.prepare(`SELECT * FROM follows WHERE follower_id = ? AND followee_id = ?`);
  const listFolloweesStmt = db.prepare(`SELECT followee_id FROM follows WHERE follower_id = ? ORDER BY created_at DESC`);
  const listFollowersStmt = db.prepare(`SELECT * FROM follows WHERE followee_id = ? ORDER BY created_at DESC, follower_id DESC LIMIT ?`);
  const listFollowersBeforeStmt = db.prepare(`
    SELECT * FROM follows
    WHERE followee_id = ? AND (created_at < ? OR (created_at = ? AND follower_id < ?))
    ORDER BY created_at DESC, follower_id DESC LIMIT ?
  `);
  const listFollowersSinceStmt = db.prepare(`
    SELECT * FROM follows WHERE followee_id = ? AND created_at > ?
    ORDER BY created_at DESC, follower_id DESC LIMIT ?
  `);
  const countFollowersStmt = db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?`);
  const countFollowingStmt = db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?`);

  const getProfileStmt = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`);
  const upsertProfileStmt = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at)
    VALUES ($user_id, $published, $mural_id, $published_at, $updated_at)
    ON CONFLICT(user_id) DO UPDATE SET
      published = excluded.published,
      mural_id = excluded.mural_id,
      published_at = excluded.published_at,
      updated_at = excluded.updated_at
  `);

  const listPublishedProfilesStmt = db.prepare(`SELECT * FROM profiles WHERE published = 1 ORDER BY updated_at DESC LIMIT ?`);

  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO events (id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source)
    VALUES ($id, $user_id, $type, $ref_type, $ref_id, $payload, $created_at, $trace_id, $source)
  `);
  const getFeedSettingsStmt = db.prepare(`SELECT show_publications, show_reading, show_votes, show_follows, show_reader_glyph FROM profiles WHERE user_id = ?`);
  const updateFeedSettingsStmt = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at, feed_settings, show_publications, show_reading, show_votes, show_follows, show_reader_glyph)
    VALUES ($user_id, 0, NULL, NULL, $updated_at, $feed_settings, $show_publications, $show_reading, $show_votes, $show_follows, $show_reader_glyph)
    ON CONFLICT(user_id) DO UPDATE SET
      feed_settings = excluded.feed_settings,
      show_publications = excluded.show_publications,
      show_reading = excluded.show_reading,
      show_votes = excluded.show_votes,
      show_follows = excluded.show_follows,
      show_reader_glyph = excluded.show_reader_glyph,
      updated_at = excluded.updated_at
  `);

  const listEventsStmt = db.prepare(`
    SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listEventsBeforeStmt = db.prepare(`
    SELECT * FROM events
    WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const typedEventStmts = new Map<string, StatementSync>();
  const listEventsOfTypes = (userId: string, types: readonly string[], bound: string, boundArgs: string[], limit: number): EventRow[] => {
    const sql = `SELECT * FROM events WHERE user_id = ? AND type IN (${types.map(() => "?").join(",")})${bound} ORDER BY created_at DESC, id DESC LIMIT ?`;
    let stmt = typedEventStmts.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      typedEventStmts.set(sql, stmt);
    }
    return stmt.all(userId, ...types, ...boundArgs, limit) as unknown as EventRow[];
  };

  return {
    deleteUserData(userId) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM follows WHERE follower_id = ? OR followee_id = ?").run(userId, userId);
        db.prepare("DELETE FROM profiles WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM events WHERE user_id = ? OR (ref_type = 'user' AND ref_id = ?)").run(userId, userId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    insertFollow(row) {
      return insertFollowStmt.run({ $follower_id: row.follower_id, $followee_id: row.followee_id, $created_at: row.created_at }).changes > 0;
    },
    deleteFollow(followerId, followeeId) {
      return deleteFollowStmt.run(followerId, followeeId).changes > 0;
    },
    getFollow(followerId, followeeId) {
      return getFollowStmt.get(followerId, followeeId) as FollowRow | undefined;
    },
    listFollowees(followerId) {
      return (listFolloweesStmt.all(followerId) as Array<{ followee_id: string }>).map((row) => row.followee_id);
    },
    listFollowersByFollowee(followeeId, keyset, limit) {
      if (keyset) {
        return listFollowersBeforeStmt.all(followeeId, keyset.createdAt, keyset.createdAt, keyset.id, limit) as unknown as FollowRow[];
      }
      return listFollowersStmt.all(followeeId, limit) as unknown as FollowRow[];
    },
    listFollowersSince(followeeId, since, limit) {
      return listFollowersSinceStmt.all(followeeId, since, limit) as unknown as FollowRow[];
    },
    countFollowers(userId) {
      return (countFollowersStmt.get(userId) as { n: number }).n;
    },
    countFollowing(userId) {
      return (countFollowingStmt.get(userId) as { n: number }).n;
    },
    getProfileRow(userId) {
      return getProfileStmt.get(userId) as ProfileRow | undefined;
    },
    upsertProfile(row) {
      upsertProfileStmt.run({
        $user_id: row.user_id,
        $published: row.published,
        $mural_id: row.mural_id,
        $published_at: row.published_at,
        $updated_at: row.updated_at
      });
    },
    listPublishedProfiles(limit) {
      return listPublishedProfilesStmt.all(limit) as unknown as ProfileRow[];
    },
    getFeedSettings(userId) {
      const row = getFeedSettingsStmt.get(userId) as { show_publications: number; show_reading: number; show_votes: number; show_follows: number; show_reader_glyph: number } | undefined;
      if (!row) return null;
      return {
        publications: row.show_publications === 1,
        reading: row.show_reading === 1,
        votes: row.show_votes === 1,
        follows: row.show_follows === 1,
        readerGlyph: row.show_reader_glyph === 1
      };
    },
    updateFeedSettings(userId, settings) {
      updateFeedSettingsStmt.run({
        $user_id: userId,
        $updated_at: new Date().toISOString(),
        $feed_settings: JSON.stringify(settings),
        $show_publications: Number(settings.publications),
        $show_reading: Number(settings.reading),
        $show_votes: Number(settings.votes),
        $show_follows: Number(settings.follows),
        $show_reader_glyph: Number(settings.readerGlyph ?? false)
      });
    },
    insertEvent(row) {
      insertEventStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $type: row.type,
        $ref_type: row.ref_type,
        $ref_id: row.ref_id,
        $payload: row.payload,
        $created_at: row.created_at,
        $trace_id: row.trace_id ?? null,
        $source: row.source ?? null
      });
    },
    listEventsByUser(userId, keyset, limit, types) {
      if (types) {
        if (types.length === 0) return [];
        return keyset
          ? listEventsOfTypes(userId, types, " AND (created_at < ? OR (created_at = ? AND id < ?))", [keyset.createdAt, keyset.createdAt, keyset.id], limit)
          : listEventsOfTypes(userId, types, "", [], limit);
      }
      if (keyset) {
        return listEventsBeforeStmt.all(userId, keyset.createdAt, keyset.createdAt, keyset.id, limit) as unknown as EventRow[];
      }
      return listEventsStmt.all(userId, limit) as unknown as EventRow[];
    },
    listEventsByUserSince(userId, since, limit, types) {
      if (types.length === 0) return [];
      return listEventsOfTypes(userId, types, " AND created_at > ?", [since], limit);
    }
  };
}
