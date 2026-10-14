import type { DatabaseSync } from "node:sqlite";
import type { ActivityEngagement } from "@scripta/shared/community";
import type { CommentRow, EngagementRepository, SavedContentRow } from "../../domain/ports.js";
import type { EventRow } from "../../domain/types.js";

export function createSqliteEngagementRepository(db: DatabaseSync): EngagementRepository {
  const event = db.prepare("SELECT * FROM events WHERE id = ? UNION ALL SELECT * FROM events_history WHERE id = ? LIMIT 1");
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
  return {
    getEvent: (id) => event.get(id, id) as EventRow | undefined,
    summaries(viewerId, ids) {
      const rows = summaries.all(viewerId, JSON.stringify(ids)) as Array<{ id: string; likes: number; comments: number; liked: number }>;
      return Object.fromEntries(rows.map((row) => [row.id, { likes: Number(row.likes), comments: Number(row.comments), liked: row.liked === 1 } satisfies ActivityEngagement]));
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
