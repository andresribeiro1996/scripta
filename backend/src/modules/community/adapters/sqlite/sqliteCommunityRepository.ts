import type { DatabaseSync } from "node:sqlite";
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
    INSERT OR IGNORE INTO events (id, user_id, type, ref_type, ref_id, created_at)
    VALUES ($id, $user_id, $type, $ref_type, $ref_id, $created_at)
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
      insertFollowStmt.run({ $follower_id: row.follower_id, $followee_id: row.followee_id, $created_at: row.created_at });
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
    insertEvent(row) {
      insertEventStmt.run({
        $id: row.id,
        $user_id: row.user_id,
        $type: row.type,
        $ref_type: row.ref_type,
        $ref_id: row.ref_id,
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
