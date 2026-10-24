// Business logic for the quizzes module. Depends only on the
// QuizzesRepository port, not on SQLite — same reasoning as every other
// module's service.ts.

import { randomUUID } from "node:crypto";
import { generateVoteCode } from "../../voteCode.js";
import type { GameByWork } from "../works/index.js";
import { QUIZ_QUESTION_TYPES, generateQuizQuestions, gradeAnswers, quizPreview, type PlayBoard, type PublicBookData, type PublicQuizQuestion, type QuestionStat, type QuizBook, type QuizPreview, type QuizQuestion, type QuizQuestionType, type ResultPlay, type SubmittedAnswer } from "@scripta/shared";
import type { GameParticipation } from "@scripta/shared/community";
import type { QuizWorks, QuizzesRepository } from "./domain/ports.js";
import { storedIds } from "./domain/quizWorks.js";
import type { AnswerRow, PlayRow, Quiz, QuizGameRow, QuizInput, QuizInputBook, QuizRow, QuizShelfFacts } from "./domain/types.js";

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

export type Player = { kind: "user"; userId: string } | { kind: "anonymous"; playId: string | null };

export type PlayOutcome =
  | { ok: true; playId: string; score: number; correct: Record<string, boolean> }
  | { ok: false; reason: "not-found" | "closed" | "invalid" | "already-played" };

export type QuizWriteOutcome =
  | { ok: true; quiz: Quiz; canonical: Map<string, string> }
  | { ok: false; reason: "not-found" | "invalid"; error: string }
  | { ok: false; reason: "duplicate-work"; title: string | null };

export type PublishOutcome =
  | { ok: true; quiz: Quiz; canonical: Map<string, string> }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "already-published"; error: string }
  | { ok: false; reason: "invalid"; error: string };

export type { PlayBoard, QuizShelfFacts };

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
  preview?: QuizPreview;
}

export interface QuizDiscoverRef {
  id: string;
  createdAt: string;
  ownerUserId: string;
}

const COVER_PREVIEW_LIMIT = 3;

function previewCovers(row: QuizRow): string[] {
  const covers: string[] = [];
  for (const book of readDocument(toQuiz(row)).books) {
    if (covers.length >= COVER_PREVIEW_LIMIT) break;
    if (typeof book?.coverUrl === "string" && book.coverUrl) covers.push(book.coverUrl);
  }
  return covers;
}

function toPublishedRef(row: QuizRow, playCount: number): PublishedQuizRef {
  const doc = readDocument(toQuiz(row));
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    voteCode: row.vote_code!,
    name: row.name,
    questionCount: doc.questionCount,
    playCount,
    playOpen: row.play_open === 1,
    covers: previewCovers(row),
    preview: quizPreview(doc)
  };
}

export type EmitPublished = (quizId: string, ownerUserId: string) => void;

export type EmitPlayed = (playerUserId: string, quizId: string, quizName: string) => void;

export interface QuizzesService {
  listQuizzes(userId: string): Quiz[];
  createQuiz(userId: string, name: string, data: QuizInput): QuizWriteOutcome;
  getQuiz(userId: string, id: string): Quiz | undefined;
  updateQuiz(userId: string, id: string, patch: { name?: string; data?: QuizInput }): QuizWriteOutcome;
  deleteQuiz(userId: string, id: string): boolean;
  publishQuiz(userId: string, id: string): PublishOutcome;
  setPlayState(userId: string, id: string, open: boolean): Quiz | undefined;
  getPlayBoard(code: string): PlayBoard | undefined;
  submitPlay(code: string, answers: SubmittedAnswer[], durationMs: number, playerName: string | null, player: Player): PlayOutcome;
  getPlay(code: string, player: Player): PlayOutcome;
  getResults(userId: string, id: string): QuizResults | undefined;
  getPublicResults(code: string): { plays: Array<Omit<ResultPlay, "playId">>; questionCount: number } | undefined;
  listPublishedByWorks(workIds: string[], limit: number): QuizGameRow[];
  topShelfFacts(since: string | null, until: string | null): QuizShelfFacts[];
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
  getPublishedRef(id: string): PublishedQuizRef | undefined;
  listPublishedRefsByOwner(ownerUserId: string): PublishedQuizRef[];
  getPublishedRefs(ids: string[]): PublishedQuizRef[];
  discoverWindow(needle: string, limit: number): QuizDiscoverRef[];
  votedAmong(viewerUserId: string, ids: string[]): string[];
}

const RECENT_PARTICIPANT_LIMIT = 10;

function quizBookWorks(works: QuizWorks, books: QuizInputBook[]): Array<string | null> {
  const given = [...new Set(books.flatMap((book) => (book.workId ? [book.workId] : [])))];
  const canonical = works.knownWorkIds(given);
  const known = new Map(given.map((id, index) => [id, canonical[index]!]));
  const titled = books.filter((book) => !book.workId);
  const resolved = works.resolveTitleWorks(titled);
  const byBook = new Map(titled.map((book, index) => [book, resolved[index] ?? null]));
  return books.map((book) => (book.workId ? known.get(book.workId)! : byBook.get(book) ?? null));
}

export function createQuizzesService(repo: QuizzesRepository, works: QuizWorks, emitPublished?: EmitPublished, emitPlayed?: EmitPlayed): QuizzesService {
  return {
    listQuizzes(userId) {
      return repo.listByUser(userId).map(toQuiz);
    },

    createQuiz(userId, name, data) {
      const ids = quizBookWorks(works, data.books);
      if (ids.some((id) => id === null)) return { ok: false, reason: "invalid", error: "That book isn't in the catalog." };
      const seen = new Set<string>();
      const books = data.books.flatMap((book, index) => {
        const workId = ids[index]!;
        if (seen.has(workId)) return [];
        seen.add(workId);
        return [{ ...book, workId }];
      });
      const now = new Date().toISOString();
      const row: QuizRow = {
        id: randomUUID(),
        owner_user_id: userId,
        name,
        data: JSON.stringify({ ...data, books }),
        vote_code: null,
        play_open: 0,
        created_at: now,
        updated_at: now
      };
      repo.insert(row);
      return { ok: true, quiz: toQuiz(row), canonical: new Map(books.map((book) => [book.workId, book.workId])) };
    },

    getQuiz(userId, id) {
      const row = repo.getOwned(id, userId);
      return row ? toQuiz(row) : undefined;
    },

    updateQuiz(userId, id, patch) {
      const existing = repo.getOwned(id, userId);
      if (!existing || existing.vote_code !== null) return { ok: false, reason: "not-found", error: "No quiz with that id." };
      let data: string | undefined;
      let canonical: Map<string, string>;
      if (patch.data) {
        const inputBooks = patch.data.books;
        const ids = quizBookWorks(works, inputBooks);
        if (ids.some((workId) => workId === null)) return { ok: false, reason: "invalid", error: "That book isn't in the catalog." };
        const duplicate = ids.findIndex((workId, index) => ids.indexOf(workId) !== index);
        if (duplicate !== -1) return { ok: false, reason: "duplicate-work", title: inputBooks[duplicate]!.title };
        data = JSON.stringify({ ...patch.data, books: inputBooks.map((book, index) => ({ ...book, workId: ids[index]! })) });
        canonical = new Map(ids.map((workId) => [workId!, workId!]));
      } else {
        canonical = works.canonicalByKey(new Map(storedIds(toQuiz(existing)).map((workId) => [workId, workId])));
      }
      const row = repo.update(id, userId, { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(data !== undefined ? { data } : {}) });
      if (!row) return { ok: false, reason: "not-found", error: "No quiz with that id." };
      return { ok: true, quiz: toQuiz(row), canonical };
    },

    deleteQuiz(userId, id) {
      return repo.delete(id, userId);
    },

    publishQuiz(userId, id) {
      const row = repo.getOwned(id, userId);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.vote_code !== null) return { ok: false, reason: "already-published", error: "This quiz is already published." };
      const doc = readDocument(toQuiz(row));
      const needCover = doc.books.filter((b) => !b.coverUrl);
      const canonical = works.canonicalByKey(new Map(doc.books.map((b) => [b.workId, b.workId])));
      const found = needCover.length ? works.publicBooksByWork(userId, needCover.map((b) => b.workId)) : new Map<string, PublicBookData>();
      const seenWorks = new Set<string>();
      doc.books = doc.books.filter((b) => {
        const work = canonical.get(b.workId) ?? b.workId;
        if (seenWorks.has(work)) return false;
        seenWorks.add(work);
        return true;
      });
      if (doc.books.length < 4) return { ok: false, reason: "invalid", error: "A quiz needs at least 4 books." };
      const books = doc.books.map((b) => ({ ...b, coverUrl: b.coverUrl ?? found.get(b.workId)?.coverUrl ?? null }));
      const code = generateVoteCode();
      const questions = generateQuizQuestions(books, { questionCount: doc.questionCount, allowedTypes: doc.allowedTypes }, code).map((question) => ({ id: question.id, type: question.type, workId: question.book.workId, options: question.options, answerIndex: question.answerIndex }));
      if (questions.length !== doc.questionCount) {
        return { ok: false, reason: "invalid", error: "Not enough books have the covers, quotes, or blurbs those question types need." };
      }
      const published = repo.publish(id, userId, JSON.stringify({ ...doc, books, questions }), code);
      if (!published) return { ok: false, reason: "not-found" };
      emitPublished?.(id, userId);
      return { ok: true, quiz: toQuiz(published), canonical };
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

    topShelfFacts: (since, until) => repo.topShelfFacts(since, until),

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
      const rows = repo.listParticipation(ownerUserId, since);
      const quizzes = new Map(repo.listPublicByIds(rows.map((row) => row.id)).map((quiz) => [quiz.id, quiz]));
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        covers: quizzes.has(row.id) ? previewCovers(quizzes.get(row.id)!) : [],
        participantCount: row.participants,
        latestAt: row.latest_at,
        recent: repo.listRecentPlayers(row.id, ownerUserId, RECENT_PARTICIPANT_LIMIT).map((r) => ({ userId: r.user_id, at: r.at }))
      }));
    }
  };
}

export interface QuizzesPublicApi {
  participationByOwner(ownerUserId: string, since: string): GameParticipation[];
  publishedByWorks(workIds: string[], limit: number): GameByWork[];
  discoverByWorks(workIds: string[], limit: number): QuizDiscoverRef[];
  topShelfFacts(since: string | null, until: string | null): QuizShelfFacts[];
  getPublished(id: string): PublishedQuizRef | undefined;
  listPublishedByOwner(ownerUserId: string): PublishedQuizRef[];
  getPublishedMany(ids: string[]): PublishedQuizRef[];
  discoverWindow(needle: string, limit: number): QuizDiscoverRef[];
  votedAmong(viewerUserId: string, ids: string[]): string[];
}

export function createQuizzesPublicApi(service: QuizzesService): QuizzesPublicApi {
  return {
    participationByOwner: (ownerUserId, since) => service.participationByOwner(ownerUserId, since),
    topShelfFacts: (since, until) => service.topShelfFacts(since, until),
    publishedByWorks: (workIds, limit) =>
      service.listPublishedByWorks(workIds, limit).map((row) => ({
        id: row.id,
        name: row.name,
        path: `/play/${row.vote_code}`,
        ownerUserId: row.owner_user_id
      })),
    discoverByWorks: (workIds, limit) =>
      service.listPublishedByWorks(workIds, limit).map((row) => ({ id: row.id, createdAt: row.created_at, ownerUserId: row.owner_user_id })),
    getPublished: (id) => service.getPublishedRef(id),
    listPublishedByOwner: (ownerUserId) => service.listPublishedRefsByOwner(ownerUserId),
    getPublishedMany: (ids) => service.getPublishedRefs(ids),
    discoverWindow: (needle, limit) => service.discoverWindow(needle, limit),
    votedAmong: (viewerUserId, ids) => service.votedAmong(viewerUserId, ids)
  };
}
