import type { DatabaseSync } from "node:sqlite";
import { normalizeFeedSettings, type FeedSettings } from "@scripta/shared/community";
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

  const insertEventStmt = db.prepare(`
    INSERT OR IGNORE INTO events (id, user_id, type, ref_type, ref_id, payload, created_at)
    VALUES ($id, $user_id, $type, $ref_type, $ref_id, $payload, $created_at)
  `);
  const getFeedSettingsStmt = db.prepare(`SELECT feed_settings FROM profiles WHERE user_id = ?`);
  const updateFeedSettingsStmt = db.prepare(`
    INSERT INTO profiles (user_id, published, mural_id, published_at, updated_at, feed_settings)
    VALUES ($user_id, 0, NULL, NULL, $updated_at, $feed_settings)
    ON CONFLICT(user_id) DO UPDATE SET feed_settings = excluded.feed_settings, updated_at = excluded.updated_at
  `);

  const listEventsStmt = db.prepare(`
    SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listEventsBeforeStmt = db.prepare(`
    SELECT * FROM events
    WHERE user_id = ? AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);

  return {
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
    countFollowers(userId) {
      return (countFollowersStmt.get(userId) as { n: number }).n;
    },
    countFollowing(userId) {
      return (countFollowingStmt.get(userId) as { n: number }).n;
    },
    countEventsByUsersSince(userIds, since) {
      if (userIds.length === 0) return 0;
      const placeholders = userIds.map(() => "?").join(",");
      const row = db.prepare(`SELECT COUNT(*) AS n FROM events WHERE user_id IN (${placeholders}) AND created_at > ?`).get(...userIds, since) as { n: number };
      return row.n;
    },
    countFollowersSince(followeeId, since) {
      return (db.prepare(`SELECT COUNT(*) AS n FROM follows WHERE followee_id = ? AND created_at > ?`).get(followeeId, since) as { n: number }).n;
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
    getFeedSettings(userId) {
      const row = getFeedSettingsStmt.get(userId) as { feed_settings: string | null } | undefined;
      if (!row || row.feed_settings === null) return null;
      try {
        return normalizeFeedSettings(JSON.parse(row.feed_settings));
      } catch {
        return null;
      }
    },
    updateFeedSettings(userId, settings) {
      updateFeedSettingsStmt.run({ $user_id: userId, $updated_at: new Date().toISOString(), $feed_settings: JSON.stringify(settings) });
    },
    insertEvent(row) {
      insertEventStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $type: row.type,
        $ref_type: row.ref_type,
        $ref_id: row.ref_id,
        $payload: row.payload,
        $created_at: row.created_at
      });
    },
    listEventsByUser(userId, keyset, limit) {
      if (keyset) {
        return listEventsBeforeStmt.all(userId, keyset.createdAt, keyset.createdAt, keyset.id, limit) as unknown as EventRow[];
      }
      return listEventsStmt.all(userId, limit) as unknown as EventRow[];
    }
  };
}
