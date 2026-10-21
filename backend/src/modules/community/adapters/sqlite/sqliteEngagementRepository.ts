import type { DatabaseSync } from "node:sqlite";
import type { ActivityEngagement } from "@scripta/shared/community";
import type { CommentRow, EngagementRepository, SavedContentRow } from "../../domain/ports.js";
import type { EventRow } from "../../domain/types.js";

export function createSqliteEngagementRepository(db: DatabaseSync): EngagementRepository {
  const event = db.prepare("SELECT * FROM events WHERE id = ? UNION ALL SELECT * FROM events_history WHERE id = ? LIMIT 1");
  const events = db.prepare("SELECT * FROM events WHERE id IN (SELECT value FROM json_each(?)) UNION ALL SELECT * FROM events_history WHERE id IN (SELECT value FROM json_each(?))");
  const summaries = db.prepare(`SELECT value AS id,
    (SELECT COUNT(*) FROM activity_likes WHERE event_id = value) AS likes,
    (SELECT COUNT(*) FROM activity_comments WHERE event_id = value) AS comments,
    EXISTS(SELECT 1 FROM activity_likes WHERE event_id = value AND user_id = ?) AS liked
    FROM json_each(?)`);
  const like = db.prepare("INSERT OR IGNORE INTO activity_likes (event_id, user_id, created_at) VALUES (?, ?, ?)");
  const unlike = db.prepare("DELETE FROM activity_likes WHERE event_id = ? AND user_id = ?");
  const comment = db.prepare("INSERT INTO activity_comments (id, event_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)");
  const comments = db.prepare("SELECT * FROM activity_comments WHERE event_id = ? ORDER BY created_at DESC, id DESC LIMIT ?");
  const olderComments = db.prepare("SELECT * FROM activity_comments WHERE event_id = ? AND (created_at, id) < (?, ?) ORDER BY created_at DESC, id DESC LIMIT ?");
  const findComment = db.prepare("SELECT * FROM activity_comments WHERE id = ?");
  const deleteComment = db.prepare("DELETE FROM activity_comments WHERE id = ? AND user_id = ?");
  const save = db.prepare("INSERT OR IGNORE INTO saved_content (user_id, kind, ref_id, owner_id, saved_at) VALUES (?, ?, ?, ?, ?)");
  const unsave = db.prepare("DELETE FROM saved_content WHERE user_id = ? AND kind = ? AND ref_id = ?");
  const saved = db.prepare("SELECT kind, ref_id, owner_id, saved_at FROM saved_content WHERE user_id = ? ORDER BY saved_at DESC, kind || ':' || ref_id DESC LIMIT ?");
  const olderSaved = db.prepare("SELECT kind, ref_id, owner_id, saved_at FROM saved_content WHERE user_id = ? AND (saved_at, kind || ':' || ref_id) < (?, ?) ORDER BY saved_at DESC, kind || ':' || ref_id DESC LIMIT ?");
  const savedState = db.prepare("SELECT s.kind, s.ref_id FROM json_each(?) f JOIN saved_content s ON s.user_id = ? AND s.kind = json_extract(f.value, '$.kind') AND s.ref_id = json_extract(f.value, '$.id')");
  const publishTypes = "type IN ('tierlist_published', 'tournament_published', 'quiz_published')";
  const gameEngagement = db.prepare(`WITH refs AS (SELECT json_extract(value, '$.kind') AS kind, json_extract(value, '$.id') AS id FROM json_each(?)),
    pub AS (
      SELECT e.id, e.ref_type, e.ref_id, e.created_at FROM refs r JOIN events e ON e.ref_type = r.kind AND e.ref_id = r.id WHERE e.${publishTypes}
      UNION ALL
      SELECT h.id, h.ref_type, h.ref_id, h.created_at FROM refs r JOIN events_history h ON h.ref_type = r.kind AND h.ref_id = r.id WHERE h.${publishTypes}
    ),
    first AS (SELECT ref_type, ref_id, id, MIN(created_at) AS published_at FROM pub GROUP BY ref_type, ref_id)
    SELECT ref_type, ref_id, published_at,
      (SELECT COUNT(*) FROM activity_likes WHERE event_id = first.id AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)) AS likes,
      (SELECT COUNT(*) FROM activity_comments WHERE event_id = first.id AND (? IS NULL OR created_at >= ?) AND (? IS NULL OR created_at < ?)) AS comments
    FROM first`);
  return {
    getEvent: (id) => event.get(id, id) as EventRow | undefined,
    getEvents(ids) {
      if (ids.length === 0) return [];
      const json = JSON.stringify(ids);
      return events.all(json, json) as unknown as EventRow[];
    },
    summaries(viewerId, ids) {
      const rows = summaries.all(viewerId, JSON.stringify(ids)) as Array<{ id: string; likes: number; comments: number; liked: number }>;
      return Object.fromEntries(rows.map((row) => [row.id, { likes: Number(row.likes), comments: Number(row.comments), liked: row.liked === 1 } satisfies ActivityEngagement]));
    },
    gameEngagement(refs, since, until) {
      if (refs.length === 0) return new Map();
      const rows = gameEngagement.all(JSON.stringify(refs), since, since, until, until, since, since, until, until) as Array<{ ref_type: string; ref_id: string; published_at: string; likes: number; comments: number }>;
      return new Map(rows.map((row) => [`${row.ref_type}:${row.ref_id}`, { publishedAt: row.published_at, likes: Number(row.likes), comments: Number(row.comments) }]));
    },
    setLiked(viewerId, eventId, liked, at) { if (liked) like.run(eventId, viewerId, at); else unlike.run(eventId, viewerId); },
    insertComment: (row) => { comment.run(row.id, row.event_id, row.user_id, row.text, row.created_at); },
    listComments: (eventId, keyset, limit) => (keyset ? olderComments.all(eventId, keyset.createdAt, keyset.id, limit) : comments.all(eventId, limit)) as unknown as CommentRow[],
    getComment: (id) => findComment.get(id) as CommentRow | undefined,
    deleteComment: (id, viewerId) => deleteComment.run(id, viewerId).changes > 0,
    setSaved(viewerId, ref, saved, at) { if (saved) save.run(viewerId, ref.kind, ref.id, ref.kind === "mural" ? ref.ownerId : null, at); else unsave.run(viewerId, ref.kind, ref.id); },
    listSaved: (viewerId, keyset, limit) => (keyset ? olderSaved.all(viewerId, keyset.createdAt, keyset.id, limit) : saved.all(viewerId, limit)) as unknown as SavedContentRow[],
    savedState: (viewerId, refs) => (savedState.all(JSON.stringify(refs), viewerId) as Array<{ kind: string; ref_id: string }>).map((row) => `${row.kind}:${row.ref_id}`)
  };
}
