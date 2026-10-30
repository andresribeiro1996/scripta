import type { DatabaseSync } from "node:sqlite";
import type { DailyChapterBook, DailyChapterQuestion } from "@scripta/shared";
import type { DailyChapterRepository, StoredDailyChapter } from "../../domain/dailyChapter.js";
import type { PlayRow } from "../../domain/types.js";

type EditionRow = { data: string; snapshot: string | null; published_at: string | null };
function edition(row: EditionRow): StoredDailyChapter {
  return { ...JSON.parse(row.data) as StoredDailyChapter, snapshot: row.snapshot === null ? null : JSON.parse(row.snapshot), publishedAt: row.published_at };
}

export function createSqliteDailyChapterRepository(db: DatabaseSync): DailyChapterRepository {
  const saveBook = db.prepare("INSERT INTO daily_chapter_books(id, data, edited_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, edited_at = excluded.edited_at");
  const importBook = db.prepare("INSERT INTO daily_chapter_books(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data WHERE daily_chapter_books.edited_at IS NULL");
  const saveQuestion = db.prepare("INSERT INTO daily_chapter_questions(id, data, edited_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, edited_at = excluded.edited_at");
  const saveEdition = db.prepare("INSERT INTO daily_chapter_editions(id, date, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET date = excluded.date, data = excluded.data WHERE daily_chapter_editions.published_at IS NULL");
  return {
    books: () => (db.prepare("SELECT data FROM daily_chapter_books ORDER BY id").all() as Array<{ data: string }>).map((row) => JSON.parse(row.data) as DailyChapterBook),
    questions: () => (db.prepare("SELECT data FROM daily_chapter_questions ORDER BY id").all() as Array<{ data: string }>).map((row) => JSON.parse(row.data) as DailyChapterQuestion),
    editions: () => (db.prepare("SELECT * FROM daily_chapter_editions ORDER BY date DESC").all() as EditionRow[]).map(edition),
    edition: (id) => { const row = db.prepare("SELECT * FROM daily_chapter_editions WHERE id = ?").get(id) as EditionRow | undefined; return row ? edition(row) : undefined; },
    saveBook: (book) => { saveBook.run(book.id, JSON.stringify(book), new Date().toISOString()); },
    saveQuestion: (question) => { saveQuestion.run(question.id, JSON.stringify(question), new Date().toISOString()); },
    saveEdition: (value) => saveEdition.run(value.id, value.date, JSON.stringify(value)).changes > 0,
    publish: (id, snapshot, at) => db.prepare("UPDATE daily_chapter_editions SET snapshot = ?, published_at = ? WHERE id = ? AND published_at IS NULL AND NOT EXISTS (SELECT 1 FROM daily_chapter_editions e, json_each(e.data, '$.questionIds') q WHERE e.published_at IS NOT NULL AND q.value IN (SELECT value FROM json_each(?)))").run(JSON.stringify(snapshot), at, id, JSON.stringify(snapshot.map((q) => q.id))).changes > 0,
    importDrafts(books, questions, editions) {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const book of books) {
          const row = db.prepare("SELECT data FROM daily_chapter_books WHERE id = ?").get(book.id) as { data: string } | undefined;
          const previous = row ? JSON.parse(row.data) as DailyChapterBook : null;
          const merged = previous ? { ...previous, themeIds: [...new Set([...previous.themeIds, ...book.themeIds])] } : book;
          importBook.run(book.id, JSON.stringify(merged));
        }
        for (const question of questions) db.prepare("INSERT INTO daily_chapter_questions(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data WHERE json_extract(daily_chapter_questions.data, '$.approvedAt') IS NULL AND json_extract(excluded.data, '$.approvedAt') IS NOT NULL AND daily_chapter_questions.edited_at IS NULL").run(question.id, JSON.stringify(question));
        for (const value of editions) db.prepare("INSERT INTO daily_chapter_editions(id, date, data) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING").run(value.id, value.date, JSON.stringify(value));
        db.exec("COMMIT");
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    },
    plays: (playerId) => db.prepare("SELECT p.* FROM quiz_plays p JOIN daily_chapter_editions e ON e.id = p.quiz_id WHERE p.voter_user_id = ? ORDER BY e.date DESC").all(playerId) as unknown as PlayRow[],
    editionPlays: (editionIds, voterIds) => db.prepare("SELECT * FROM quiz_plays WHERE quiz_id IN (SELECT value FROM json_each(?)) AND (? IS NULL OR voter_user_id IN (SELECT value FROM json_each(?)))").all(JSON.stringify(editionIds), voterIds ? JSON.stringify(voterIds) : null, voterIds ? JSON.stringify(voterIds) : null) as unknown as PlayRow[],
    claimGuest(guestKey, userId) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("UPDATE quiz_plays SET voter_user_id = ? WHERE voter_user_id = ? AND quiz_id IN (SELECT id FROM daily_chapter_editions) AND NOT EXISTS (SELECT 1 FROM quiz_plays own WHERE own.quiz_id = quiz_plays.quiz_id AND own.voter_user_id = ?)").run(userId, guestKey, userId);
        db.exec("COMMIT");
      } catch (error) { if (db.isTransaction) db.exec("ROLLBACK"); throw error; }
    }
  };
}
