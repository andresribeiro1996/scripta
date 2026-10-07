// Business logic for the quizzes module. Depends only on the
// QuizzesRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomBytes, randomUUID } from "node:crypto";
import { QUIZ_QUESTION_TYPES, generateQuizQuestions, gradeAnswers, type PublicQuizQuestion, type QuestionStat, type QuizBook, type QuizQuestion, type QuizQuestionType, type ResultPlay, type SubmittedAnswer } from "@scripta/shared";
import type { GameParticipation } from "@scripta/shared/community";
import type { QuizzesRepository } from "./domain/ports.js";
import type { AnswerRow, PlayRow, Quiz, QuizGameRow, QuizRow } from "./domain/types.js";

function toQuiz(row: QuizRow): Quiz {
  const parsed = JSON.parse(row.data) as unknown;
  return {
    id: row.id,
    name: row.name,
    data: parsed,
    voteCode: row.vote_code,
    playOpen: row.play_open === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** The one place this module looks inside the opaque `data` document —
 *  parsed defensively, same stance as tierlists' readDocument. */
interface QuizDocument {
  sourceLabel: string;
  questionCount: number;
  allowedTypes: QuizQuestionType[];
  books: QuizBook[];
  questions: QuizQuestion[] | null;
}

function readDocument(quiz: Quiz): QuizDocument {
  const data = (quiz.data ?? {}) as Partial<QuizDocument>;
  return {
    sourceLabel: typeof data.sourceLabel === "string" ? data.sourceLabel : "",
    questionCount: typeof data.questionCount === "number" ? data.questionCount : 10,
    allowedTypes: Array.isArray(data.allowedTypes) ? data.allowedTypes : [...QUIZ_QUESTION_TYPES],
    books: Array.isArray(data.books) ? data.books : [],
    questions: Array.isArray(data.questions) ? data.questions : null
  };
}

// Same unambiguous alphabet as tierlists' vote codes — these get read
// aloud and typed by hand. An identifier, not a secret.
const CODE_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function generateVoteCode(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export type Player = { kind: "user"; userId: string } | { kind: "anonymous"; playId: string | null };

export type PlayOutcome =
  | { ok: true; playId: string; score: number; correct: Record<string, boolean> }
  | { ok: false; reason: "not-found" | "closed" | "invalid" | "already-played" };

export type PublishOutcome =
  | { ok: true; quiz: Quiz }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "already-published"; error: string }
  | { ok: false; reason: "invalid"; error: string };

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface QuizResults {
  plays: ResultPlay[];
  stats: QuestionStat[];
  questionCount: number;
}

function toResultPlay(row: PlayRow): ResultPlay {
  return { playId: row.id, playerName: row.player_name, score: row.score, durationMs: row.duration_ms, createdAt: row.created_at };
}

function toPublicQuestion(question: QuizQuestion, bookByWork: Map<string, QuizBook>): PublicQuizQuestion {
  const book = question.workId === null ? undefined : bookByWork.get(question.workId);
  const prompt =
    question.type === "cover_title"
      ? book?.coverUrl ?? ""
      : question.type === "title_cover"
        ? book?.title ?? ""
        : question.type === "quote_title"
          ? book?.quote ?? ""
          : book?.blurb ?? "";
  return { id: question.id, type: question.type, prompt, options: question.options };
}

export interface PublishedQuizRef {
  id: string;
  ownerUserId: string;
  createdAt: string;
  voteCode: string;
  name: string;
  questionCount: number;
  playCount: number;
  playOpen: boolean;
  covers: string[];
}

export interface QuizDiscoverRef {
  id: string;
  createdAt: string;
  ownerUserId: string;
}

const COVER_PREVIEW_LIMIT = 3;

function toPublishedRef(row: QuizRow, playCount: number): PublishedQuizRef {
  const doc = readDocument(toQuiz(row));
  const covers: string[] = [];
  for (const book of doc.books) {
    if (covers.length >= COVER_PREVIEW_LIMIT) break;
    if (typeof book?.coverUrl === "string" && book.coverUrl) covers.push(book.coverUrl);
  }
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    voteCode: row.vote_code!,
    name: row.name,
    questionCount: doc.questionCount,
    playCount,
    playOpen: row.play_open === 1,
    covers
  };
}

export type EmitPublished = (quizId: string, ownerUserId: string) => void;

export type EmitPlayed = (playerUserId: string, quizId: string, quizName: string) => void;

export interface QuizzesService {
  listQuizzes(userId: string): Quiz[];
  createQuiz(userId: string, name: string, data: unknown): Quiz;
  getQuiz(userId: string, id: string): Quiz | undefined;
  updateQuiz(userId: string, id: string, patch: { name?: string; data?: unknown }): Quiz | undefined;
  deleteQuiz(userId: string, id: string): boolean;
  /** `resolvedBooks` carries the public cover URLs the route resolved from
   *  the owner's library (the same resolver tierlists' open-voting uses);
   *  books that already carry one (pool picks) keep theirs. */
  publishQuiz(userId: string, id: string, resolvedBooks: Array<{ workId: string; coverUrl: string | null }>, canonical?: Map<string, string>): PublishOutcome;
  setPlayState(userId: string, id: string, open: boolean): Quiz | undefined;
  getPlayBoard(code: string): PlayBoard | undefined;
  submitPlay(code: string, answers: SubmittedAnswer[], durationMs: number, playerName: string | null, player: Player): PlayOutcome;
  getPlay(code: string, player: Player): PlayOutcome;
  getResults(userId: string, id: string): QuizResults | undefined;
  getPublicResults(code: string): { plays: Array<Omit<ResultPlay, "playId">>; questionCount: number } | undefined;
  listPublishedByWorks(workIds: string[], limit: number): QuizGameRow[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
  getPublishedRef(id: string): PublishedQuizRef | undefined;
  listPublishedRefsByOwner(ownerUserId: string): PublishedQuizRef[];
  getPublishedRefs(ids: string[]): PublishedQuizRef[];
  discoverWindow(needle: string, limit: number): QuizDiscoverRef[];
  votedAmong(viewerUserId: string, ids: string[]): string[];
}

const RECENT_PARTICIPANT_LIMIT = 10;

export function createQuizzesService(repo: QuizzesRepository, emitPublished?: EmitPublished, emitPlayed?: EmitPlayed): QuizzesService {
  return {
    listQuizzes(userId) {
      return repo.listByUser(userId).map(toQuiz);
    },

    createQuiz(userId, name, data) {
      const now = new Date().toISOString();
      const row: QuizRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name,
        data: JSON.stringify(data ?? {}),
        vote_code: null,
        play_open: 0,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return toQuiz(row);
    },

    getQuiz(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toQuiz(row) : undefined;
    },

    updateQuiz(userId, id, patch) {
      if (patch.data !== undefined || patch.name !== undefined) {
        const existing = repo.getOwned(id, userId);
        // undefined covers BOTH "not yours" and "already published" — a
        // published quiz's seeded set must never drift (same 404 convention
        // as tierlists' updateTierlist).
        if (!existing || existing.vote_code !== null) return undefined;
      }
      const row = repo.update(id, userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.data !== undefined ? { data: JSON.stringify(patch.data) } : {})
      });
      return row ? toQuiz(row) : undefined;
    },

    deleteQuiz(userId, id) {
      return repo.delete(id, userId);
    },

    publishQuiz(userId, id, resolvedBooks, canonical = new Map()) {
      const row = repo.getOwned(id, userId);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.vote_code !== null) return { ok: false, reason: "already-published", error: "This quiz is already published." };
      const doc = readDocument(toQuiz(row));
      const seenWorks = new Set<string>();
      doc.books = doc.books.filter((b) => {
        const work = canonical.get(b.workId) ?? b.workId;
        if (seenWorks.has(work)) return false;
        seenWorks.add(work);
        return true;
      });
      if (doc.books.length < 4) return { ok: false, reason: "invalid", error: "A quiz needs at least 4 books." };
      const coverByWork = new Map(resolvedBooks.map((b) => [b.workId, b.coverUrl]));
      const books = doc.books.map((b) => ({ ...b, coverUrl: b.coverUrl ?? coverByWork.get(b.workId) ?? null }));
      const code = generateVoteCode();
      const questions = generateQuizQuestions(books, { questionCount: doc.questionCount, allowedTypes: doc.allowedTypes }, code).map((question) => ({ id: question.id, type: question.type, workId: question.book.workId, options: question.options, answerIndex: question.answerIndex }));
      if (questions.length !== doc.questionCount) {
        return { ok: false, reason: "invalid", error: "Not enough books have the covers, quotes, or blurbs those question types need." };
      }
      const published = repo.publish(id, userId, JSON.stringify({ ...doc, books, questions }), code);
      if (!published) return { ok: false, reason: "not-found" };
      emitPublished?.(id, userId);
      return { ok: true, quiz: toQuiz(published) };
    },

    setPlayState(userId, id, open) {
      const row = repo.setPlayOpen(id, userId, open ? 1 : 0);
      return row ? toQuiz(row) : undefined;
    },

    getPlayBoard(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      const doc = readDocument(toQuiz(row));
      const bookByWork = new Map(doc.books.map((b) => [b.workId, b]));
      return {
        name: row.name,
        sourceLabel: doc.sourceLabel,
        questionCount: doc.questionCount,
        playOpen: row.play_open === 1,
        playCount: repo.playCount(row.id),
        questions: (doc.questions ?? []).map((q) => toPublicQuestion(q, bookByWork))
      };
    },

    submitPlay(code, answers, durationMs, playerName, player) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.play_open !== 1) return { ok: false, reason: "closed" };
      const doc = readDocument(toQuiz(row));
      const questions = doc.questions ?? [];
      if (!doc.questions) return { ok: false, reason: "invalid" };
      if (answers.length !== questions.length) return { ok: false, reason: "invalid" };
      const byId = new Map(questions.map((q) => [q.id, q]));
      const seen = new Set<string>();
      for (const answer of answers) {
        const question = byId.get(answer.questionId);
        if (!question || seen.has(answer.questionId)) return { ok: false, reason: "invalid" };
        if (answer.choiceIndex < 0 || answer.choiceIndex >= question.options.length) return { ok: false, reason: "invalid" };
        seen.add(answer.questionId);
      }

      const existing =
        player.kind === "user"
          ? repo.getPlayByVoter(row.id, player.userId)
          : player.playId
            ? repo.getPlayById(row.id, player.playId)
            : undefined;
      if (existing) return { ok: false, reason: "already-played" };

      const { score, correct } = gradeAnswers(questions, answers);
      const now = new Date().toISOString();
      const play: PlayRow = {
        id: randomUUID(),
        quiz_id: row.id,
        voter_user_id: player.kind === "user" ? player.userId : null,
        player_name: playerName,
        score,
        duration_ms: durationMs,
        created_at: now,
        updated_at: now
      };
      const answerRows: AnswerRow[] = answers.map((answer) => ({
        play_id: play.id,
        quiz_id: row.id,
        question_id: answer.questionId,
        choice_index: answer.choiceIndex,
        correct: correct[answer.questionId] ? 1 : 0
      }));
      repo.savePlay(play, answerRows);
      if (player.kind === "user") emitPlayed?.(player.userId, row.id, row.name);
      return { ok: true, playId: play.id, score, correct };
    },

    getPlay(code, player) {
      const row = repo.getByVoteCode(code);
      if (!row) return { ok: false, reason: "not-found" };
      const existing =
        player.kind === "user"
          ? repo.getPlayByVoter(row.id, player.userId)
          : player.playId
            ? repo.getPlayById(row.id, player.playId)
            : undefined;
      if (!existing) return { ok: false, reason: "not-found" };
      const correct: Record<string, boolean> = {};
      for (const answer of repo.getAnswers(existing.id)) correct[answer.question_id] = answer.correct === 1;
      return { ok: true, playId: existing.id, score: existing.score, correct };
    },

    getResults(userId, id) {
      if (!repo.getOwned(id, userId)) return undefined;
      const row = repo.getById(id)!;
      return {
        plays: repo.listPlays(id).map(toResultPlay),
        stats: repo.questionStats(id),
        questionCount: readDocument(toQuiz(row)).questionCount
      };
    },

    getPublicResults(code) {
      const row = repo.getByVoteCode(code);
      if (!row) return undefined;
      // playId stays owner-side: it's an anonymous player's only play
      // handle, and the public leaderboard must not hand out everyone's.
      return {
        plays: repo.listPlays(row.id).map((playRow) => {
          const { playId: _playId, ...rest } = toResultPlay(playRow);
          return rest;
        }),
        questionCount: readDocument(toQuiz(row)).questionCount
      };
    },

    listPublishedByWorks: (workIds, limit) => repo.listPublishedByWorks(workIds, limit),

    getPublishedRef(id) {
      const row = repo.getPublicById(id);
      return row ? toPublishedRef(row, repo.playCount(id)) : undefined;
    },

    listPublishedRefsByOwner(ownerUserId) {
      const rows = repo.listPublicByUser(ownerUserId);
      const counts = repo.playCountsFor(rows.map((row) => row.id));
      return rows.map((row) => toPublishedRef(row, counts.get(row.id) ?? 0));
    },

    getPublishedRefs(ids) {
      const counts = repo.playCountsFor(ids);
      return repo.listPublicByIds(ids).map((row) => toPublishedRef(row, counts.get(row.id) ?? 0));
    },

    discoverWindow(needle, limit) {
      return repo.discoverWindow(needle, limit).map((row) => ({ id: row.id, createdAt: row.created_at, ownerUserId: row.owner_user_id }));
    },

    votedAmong: (viewerUserId, ids) => repo.votedAmong(viewerUserId, ids),

    participationByOwner(ownerUserId, since) {
      return repo.listParticipation(ownerUserId, since).map((row) => ({
        id: row.id,
        name: row.name,
        covers: [],
        participantCount: row.participants,
        latestAt: row.latest_at,
        recent: repo.listRecentPlayers(row.id, ownerUserId, RECENT_PARTICIPANT_LIMIT).map((r) => ({ userId: r.user_id, at: r.at }))
      }));
    }
  };
}

export interface GameByWork {
  id: string;
  name: string;
  path: string;
  ownerUserId: string | null;
}

export interface QuizzesPublicApi {
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
  publishedByWorks(workIds: string[], limit: number): GameByWork[];
  getPublished(id: string): PublishedQuizRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedQuizRef[];
  getPublishedMany(ids: string[]): PublishedQuizRef[];
  discoverWindow(needle: string, limit: number): QuizDiscoverRef[];
  votedAmong(viewerUserId: string, ids: string[]): string[];
}

export function createQuizzesPublicApi(service: QuizzesService): QuizzesPublicApi {
  return {
    participationByOwner: (ownerUserId, since) => service.participationByOwner(ownerUserId, since),
    publishedByWorks: (workIds, limit) =>
      service.listPublishedByWorks(workIds, limit).map((row) => ({
        id: row.id,
        name: row.name,
        path: `/play/${row.vote_code}`,
        ownerUserId: row.owner_user_id
      })),
    getPublished: (id) => service.getPublishedRef(id),
    listPublishedByOwner: (ownerUserId) => service.listPublishedRefsByOwner(ownerUserId),
    getPublishedMany: (ids) => service.getPublishedRefs(ids),
    discoverWindow: (needle, limit) => service.discoverWindow(needle, limit),
    votedAmong: (viewerUserId, ids) => service.votedAmong(viewerUserId, ids)
  };
}
