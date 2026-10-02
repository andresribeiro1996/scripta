import type { DatabaseSync } from "node:sqlite";
import { categoryFor, DEFAULT_FEED_SETTINGS } from "@scripta/shared/community";
import { FEED_EVENT_TYPES, FEED_WINDOW_MS, FOLLOW_COPY_LIMIT } from "../../domain/feed.js";
import type { CommunityRepository } from "../../domain/ports.js";
import type { EventRow, FollowRow, ProfileRow } from "../../domain/types.js";
import { feedSettingColumns, inTransaction } from "./connection.js";

const authorShows = `CASE e.type ${FEED_EVENT_TYPES.map((type) => `WHEN '${type}' THEN COALESCE(p.show_${categoryFor(type)}, ${Number(DEFAULT_FEED_SETTINGS[categoryFor(type)])})`).join(" ")} END = 1`;
const inboxFrom = "FROM feed_inbox i JOIN events e ON e.id = i.event_id LEFT JOIN profiles p ON p.user_id = i.author_id";
const inboxWhere = `i.viewer_id = ? AND e.type IN (SELECT value FROM json_each(?)) AND ${authorShows}`;
const notHidden = "type NOT IN (SELECT value FROM json_each(?))";

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
  const countEventsSinceStmt = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM events WHERE user_id = ? AND created_at >= ? AND type IN (SELECT value FROM json_each(?)) LIMIT ?)`);
  const fanOutStmt = db.prepare(`
    INSERT OR IGNORE INTO feed_inbox (viewer_id, created_at, event_id, author_id)
    SELECT f.follower_id, e.created_at, e.id, e.user_id
    FROM events e JOIN follows f ON f.followee_id = e.user_id LEFT JOIN profiles p ON p.user_id = e.user_id
    WHERE e.id = $id AND ${authorShows}
  `);
  const copyToInboxStmt = db.prepare(`
    INSERT OR IGNORE INTO feed_inbox (viewer_id, created_at, event_id, author_id)
    SELECT $follower_id, e.created_at, e.id, e.user_id
    FROM events e LEFT JOIN profiles p ON p.user_id = e.user_id
    WHERE e.user_id = $followee_id AND e.created_at >= $since AND ${authorShows}
    ORDER BY e.created_at DESC, e.id DESC LIMIT $limit
  `);
  const deleteInboxFromAuthorStmt = db.prepare(`DELETE FROM feed_inbox WHERE viewer_id = ? AND author_id = ?`);
  const listInboxStmt = db.prepare(`SELECT e.* ${inboxFrom} WHERE ${inboxWhere} ORDER BY i.created_at DESC, i.event_id DESC LIMIT ?`);
  const listInboxBeforeStmt = db.prepare(`SELECT e.* ${inboxFrom} WHERE ${inboxWhere} AND (i.created_at, i.event_id) < (?, ?) ORDER BY i.created_at DESC, i.event_id DESC LIMIT ?`);
  const countInboxSinceStmt = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 ${inboxFrom} WHERE ${inboxWhere} AND i.created_at > ? LIMIT ?)`);
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
    SELECT * FROM events WHERE user_id = ? AND ${notHidden} ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listEventsBeforeStmt = db.prepare(`
    SELECT * FROM events
    WHERE user_id = ? AND created_at <= ? AND (created_at < ? OR (created_at = ? AND id < ?)) AND ${notHidden}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listHistoryStmt = db.prepare(`
    SELECT * FROM events_history WHERE user_id = ? AND ${notHidden} ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const listHistoryBeforeStmt = db.prepare(`
    SELECT * FROM events_history
    WHERE user_id = ? AND (created_at, id) < (?, ?) AND ${notHidden}
    ORDER BY created_at DESC, id DESC LIMIT ?
  `);
  const oldestEvents = `FROM events WHERE created_at < $cutoff ORDER BY created_at, id LIMIT $batch`;
  const copyOldEventsStmt = db.prepare(`
    INSERT INTO events_history (id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source)
    SELECT id, user_id, type, ref_type, ref_id, payload, created_at, trace_id, source ${oldestEvents}
  `);
  const deleteOldEventsStmt = db.prepare(`DELETE FROM events WHERE id IN (SELECT id ${oldestEvents})`);
  const purgeInboxStmt = db.prepare(`
    DELETE FROM feed_inbox WHERE (viewer_id, created_at, event_id) IN (
      SELECT viewer_id, created_at, event_id FROM feed_inbox WHERE created_at < $cutoff LIMIT $batch
    )
  `);

  return {
    deleteUserData(userId) {
      inTransaction(db, () => {
        db.prepare("DELETE FROM follows WHERE follower_id = ? OR followee_id = ?").run(userId, userId);
        db.prepare("DELETE FROM feed_inbox WHERE viewer_id = ? OR author_id = ?").run(userId, userId);
        db.prepare("DELETE FROM profiles WHERE user_id = ?").run(userId);
        db.prepare("DELETE FROM events WHERE user_id = ? OR (ref_type = 'user' AND ref_id = ?)").run(userId, userId);
        db.prepare("DELETE FROM events_history WHERE user_id = ? OR (ref_type = 'user' AND ref_id = ?)").run(userId, userId);
      });
    },
    insertFollow(row) {
      return inTransaction(db, () => {
        const inserted = insertFollowStmt.run({ $follower_id: row.follower_id, $followee_id: row.followee_id, $created_at: row.created_at }).changes > 0;
        if (inserted) {
          copyToInboxStmt.run({
            $follower_id: row.follower_id,
            $followee_id: row.followee_id,
            $since: new Date(Date.parse(row.created_at) - FEED_WINDOW_MS).toISOString(),
            $limit: FOLLOW_COPY_LIMIT
          });
        }
        return inserted;
      });
    },
    deleteFollow(followerId, followeeId) {
      return inTransaction(db, () => {
        const deleted = deleteFollowStmt.run(followerId, followeeId).changes > 0;
        if (deleted) deleteInboxFromAuthorStmt.run(followerId, followeeId);
        return deleted;
      });
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
        ...feedSettingColumns(settings)
      });
    },
    insertEvent(row) {
      inTransaction(db, () => {
        const inserted = insertEventStmt.run({
          $id: row.id,
          $user_id: row.user_id,
          $type: row.type,
          $ref_type: row.ref_type,
          $ref_id: row.ref_id,
          $payload: row.payload,
          $created_at: row.created_at,
          $trace_id: row.trace_id ?? null,
          $source: row.source ?? null
        }).changes > 0;
        if (inserted && FEED_EVENT_TYPES.includes(row.type)) fanOutStmt.run({ $id: row.id });
      });
    },
    countEventsSince(userId, since, types, limit) {
      return (countEventsSinceStmt.get(userId, since, JSON.stringify(types), limit) as { n: number }).n;
    },
    listEventsByUser(userId, keyset, limit, hiddenTypes) {
      const hidden = JSON.stringify(hiddenTypes);
      if (keyset) {
        return listEventsBeforeStmt.all(userId, keyset.createdAt, keyset.createdAt, keyset.createdAt, keyset.id, hidden, limit) as unknown as EventRow[];
      }
      return listEventsStmt.all(userId, hidden, limit) as unknown as EventRow[];
    },
    listHistoryEventsByUser(userId, keyset, limit, hiddenTypes) {
      const hidden = JSON.stringify(hiddenTypes);
      const rows = keyset ? listHistoryBeforeStmt.all(userId, keyset.createdAt, keyset.id, hidden, limit) : listHistoryStmt.all(userId, hidden, limit);
      return rows as unknown as EventRow[];
    },
    listInbox(viewerId, keyset, limit, types) {
      if (types.length === 0) return [];
      const kinds = JSON.stringify(types);
      const rows = keyset ? listInboxBeforeStmt.all(viewerId, kinds, keyset.createdAt, keyset.id, limit) : listInboxStmt.all(viewerId, kinds, limit);
      return rows as unknown as EventRow[];
    },
    countInboxSince(viewerId, since, types, limit) {
      if (types.length === 0) return 0;
      return (countInboxSinceStmt.get(viewerId, JSON.stringify(types), since, limit) as { n: number }).n;
    },
    moveEventsBefore(cutoff, batch) {
      return inTransaction(db, () => {
        copyOldEventsStmt.run({ $cutoff: cutoff, $batch: batch });
        return Number(deleteOldEventsStmt.run({ $cutoff: cutoff, $batch: batch }).changes);
      });
    },
    purgeInboxBefore(cutoff, batch) {
      return Number(purgeInboxStmt.run({ $cutoff: cutoff, $batch: batch }).changes);
    }
  };
}
