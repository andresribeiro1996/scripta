// The SQLite implementation of the QuizzesRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the port.

import type { DatabaseSync } from "node:sqlite";
import type { QuestionStat } from "@scripta/shared";
import type { QuizzesRepository } from "../../domain/ports.js";
import type { AnswerRow, PlayRow, QuizRow } from "../../domain/types.js";

export function createSqliteQuizzesRepository(db: DatabaseSync): QuizzesRepository {
  const insertStmt = db.prepare(`
    INSERT INTO quizzes (id, owner_user_id, name, data, vote_code, play_open, created_at, updated_at)
    VALUES ($id, $owner_user_id, $name, $data, $vote_code, $play_open, $created_at, $updated_at)
  `);
  const listStmt = db.prepare(`SELECT * FROM quizzes WHERE owner_user_id = ? ORDER BY created_at DESC`);
  const getOwnedStmt = db.prepare(`SELECT * FROM quizzes WHERE id = ? AND owner_user_id = ?`);
  const getByIdStmt = db.prepare(`SELECT * FROM quizzes WHERE id = ?`);
  const updateStmt = db.prepare(`UPDATE quizzes SET name = $name, data = $data, updated_at = $updated_at WHERE id = $id AND owner_user_id = $owner_user_id`);
  const deleteQuizStmt = db.prepare(`DELETE FROM quizzes WHERE id = ? AND owner_user_id = ?`);
  const deletePlaysStmt = db.prepare(`DELETE FROM quiz_plays WHERE quiz_id = ?`);
  const deleteAnswersStmt = db.prepare(`DELETE FROM quiz_play_answers WHERE quiz_id = ?`);
  const getByVoteCodeStmt = db.prepare(`SELECT * FROM quizzes WHERE vote_code = ?`);
  const publishStmt = db.prepare(`UPDATE quizzes SET data = ?, vote_code = ?, play_open = 1, updated_at = ? WHERE id = ? AND owner_user_id = ? AND vote_code IS NULL`);
  const setPlayOpenStmt = db.prepare(`UPDATE quizzes SET play_open = $play_open, updated_at = $updated_at WHERE id = $id AND owner_user_id = $owner_user_id`);
  const insertPlayStmt = db.prepare(`
    INSERT INTO quiz_plays (id, quiz_id, voter_user_id, player_name, score, duration_ms, created_at, updated_at)
    VALUES ($id, $quiz_id, $voter_user_id, $player_name, $score, $duration_ms, $created_at, $updated_at)
  `);
  const insertAnswerStmt = db.prepare(`
    INSERT INTO quiz_play_answers (play_id, quiz_id, question_id, choice_index, correct)
    VALUES ($play_id, $quiz_id, $question_id, $choice_index, $correct)
  `);
  const getPlayByIdStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? AND id = ?`);
  const getPlayByVoterStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? AND voter_user_id = ?`);
  const getAnswersStmt = db.prepare(`SELECT * FROM quiz_play_answers WHERE play_id = ? ORDER BY question_id ASC`);
  const listPlaysStmt = db.prepare(`SELECT * FROM quiz_plays WHERE quiz_id = ? ORDER BY score DESC, duration_ms ASC, created_at ASC`);
  const playCountStmt = db.prepare(`SELECT COUNT(*) AS n FROM quiz_plays WHERE quiz_id = ?`);
  const statsStmt = db.prepare(`
    SELECT question_id, choice_index, COUNT(*) AS picks, SUM(correct) AS correct
    FROM quiz_play_answers WHERE quiz_id = ?
    GROUP BY question_id, choice_index ORDER BY question_id ASC, choice_index ASC
  `);
  const participationStmt = db.prepare(`
    SELECT q.id, q.name, COUNT(p.id) AS participants, MAX(p.created_at) AS latest_at
    FROM quizzes q JOIN quiz_plays p ON p.quiz_id = q.id
    WHERE q.owner_user_id = ? AND (p.voter_user_id IS NULL OR p.voter_user_id != q.owner_user_id)
    GROUP BY q.id
    HAVING MAX(p.created_at) >= ?
  `);
  const recentPlayersStmt = db.prepare(`
    SELECT voter_user_id AS user_id, created_at AS at FROM quiz_plays
    WHERE quiz_id = ? AND voter_user_id IS NOT NULL AND voter_user_id != ?
    ORDER BY created_at DESC LIMIT ?
  `);

  const now = (): string => new Date().toISOString();

  return {
    listByUser(userId) {
      return listStmt.all(userId) as unknown as QuizRow[];
    },

    getOwned(id, userId) {
      return getOwnedStmt.get(id, userId) as QuizRow | undefined;
    },

    getById(id) {
      return getByIdStmt.get(id) as QuizRow | undefined;
    },

    insert(row) {
      insertStmt.run({
        $id: row.id,
        $owner_user_id: row.owner_user_id,
        $name: row.name,
        $data: row.data,
        $vote_code: row.vote_code,
        $play_open: row.play_open,
        $created_at: row.created_at,
        $updated_at: row.updated_at
      });
    },

    update(id, userId, patch) {
      const existing = getOwnedStmt.get(id, userId) as QuizRow | undefined;
      if (!existing || existing.vote_code !== null) return undefined;
      const merged: QuizRow = { ...existing, ...patch, updated_at: now() };
      updateStmt.run({ $id: id, $owner_user_id: userId, $name: merged.name, $data: merged.data, $updated_at: merged.updated_at });
      return merged;
    },

    delete(id, userId) {
      if (!getOwnedStmt.get(id, userId)) return false;
      db.exec("BEGIN");
      try {
        deleteAnswersStmt.run(id);
        deletePlaysStmt.run(id);
        const result = deleteQuizStmt.run(id, userId);
        db.exec("COMMIT");
        return result.changes > 0;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    rekeyBooks(userId, fromKeys, toKey) {
      const from = new Set(fromKeys);
      const now = new Date().toISOString();
      const update = db.prepare("UPDATE quizzes SET data = ?, updated_at = ? WHERE id = ?");
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of db.prepare("SELECT id, data FROM quizzes WHERE owner_user_id = ? AND vote_code IS NULL").all(userId) as Array<{ id: string; data: string }>) {
          const parsed = JSON.parse(row.data) as Record<string, unknown>;
          if (!Array.isArray(parsed.books)) continue;
          const seen = new Set<string>();
          const books = parsed.books.flatMap((book: unknown) => {
            if (typeof book !== "object" || book === null || typeof (book as { key?: unknown }).key !== "string") return [book];
            const key = from.has((book as { key: string }).key) ? toKey : (book as { key: string }).key;
            if (seen.has(key)) return [];
            seen.add(key);
            return [{ ...book, key }];
          });
          const after = JSON.stringify({ ...parsed, books });
          if (after !== JSON.stringify(parsed)) update.run(after, now, row.id);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    deleteUserData(userId) {
      // Own quizzes (with their plays and answers) go; the account's plays
      // on other people's quizzes are unlinked, not deleted — the
      // leaderboard keeps its rows, now attributed to nobody (tierlists'
      // same unlink-not-delete rule).
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM quiz_play_answers WHERE quiz_id IN (SELECT id FROM quizzes WHERE owner_user_id = ?)").run(userId);
        db.prepare("DELETE FROM quiz_plays WHERE quiz_id IN (SELECT id FROM quizzes WHERE owner_user_id = ?)").run(userId);
        db.prepare("DELETE FROM quizzes WHERE owner_user_id = ?").run(userId);
        db.prepare("UPDATE quiz_plays SET voter_user_id = NULL WHERE voter_user_id = ?").run(userId);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getByVoteCode(code) {
      return getByVoteCodeStmt.get(code) as QuizRow | undefined;
    },

    publish(id, userId, data, code) {
      const result = publishStmt.run(data, code, now(), id, userId);
      if (!result.changes) return undefined;
      return getOwnedStmt.get(id, userId) as unknown as QuizRow;
    },

    setPlayOpen(id, userId, open) {
      const existing = getOwnedStmt.get(id, userId) as QuizRow | undefined;
      if (!existing) return undefined;
      const updatedAt = now();
      setPlayOpenStmt.run({ $id: id, $owner_user_id: userId, $play_open: open, $updated_at: updatedAt });
      return { ...existing, play_open: open, updated_at: updatedAt };
    },

    getPlayById(quizId, playId) {
      return getPlayByIdStmt.get(quizId, playId) as PlayRow | undefined;
    },

    getPlayByVoter(quizId, voterUserId) {
      return getPlayByVoterStmt.get(quizId, voterUserId) as PlayRow | undefined;
    },

    savePlay(play, answers) {
      db.exec("BEGIN");
      try {
        insertPlayStmt.run({
          $id: play.id,
          $quiz_id: play.quiz_id,
          $voter_user_id: play.voter_user_id,
          $player_name: play.player_name,
          $score: play.score,
          $duration_ms: play.duration_ms,
          $created_at: play.created_at,
          $updated_at: play.updated_at
        });
        for (const answer of answers) {
          insertAnswerStmt.run({
            $play_id: answer.play_id,
            $quiz_id: answer.quiz_id,
            $question_id: answer.question_id,
            $choice_index: answer.choice_index,
            $correct: answer.correct
          });
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getAnswers(playId) {
      return getAnswersStmt.all(playId) as unknown as AnswerRow[];
    },

    listPlays(quizId) {
      return listPlaysStmt.all(quizId) as unknown as PlayRow[];
    },

    playCount(quizId) {
      return Number((playCountStmt.get(quizId) as { n: number }).n);
    },

    questionStats(quizId) {
      const rows = statsStmt.all(quizId) as unknown as Array<{ question_id: string; choice_index: number; picks: number; correct: number }>;
      const byQuestion = new Map<string, QuestionStat>();
      for (const row of rows) {
        let stat = byQuestion.get(row.question_id);
        if (!stat) {
          stat = { questionId: row.question_id, answerCount: 0, correctCount: 0, picks: [] };
          byQuestion.set(row.question_id, stat);
        }
        stat.answerCount += Number(row.picks);
        stat.correctCount += Number(row.correct);
        stat.picks.push({ choiceIndex: Number(row.choice_index), count: Number(row.picks) });
      }
      return [...byQuestion.values()];
    },

    listParticipation(ownerUserId, since) {
      const rows = participationStmt.all(ownerUserId, since) as unknown as Array<{ id: string; name: string; participants: number; latest_at: string }>;
      return rows.map((r) => ({ ...r, participants: Number(r.participants) }));
    },

    listRecentPlayers(quizId, ownerUserId, limit) {
      return recentPlayersStmt.all(quizId, ownerUserId, limit) as unknown as Array<{ user_id: string; at: string }>;
    }
  };
}
