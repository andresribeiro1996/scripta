// The port: everything the quizzes domain (service.ts) needs from
// persistence. Same contract shape as modules/tierlists/domain/ports.ts —
// service.ts is written against this interface only.

import type { QuestionStat } from "@scripta/shared";
import type { AnswerRow, PlayRow, QuizRow } from "./types.js";

export interface QuizzesRepository {
  listByUser(userId: string): QuizRow[];
  /** Ownership-checked lookup — undefined if no row with that id exists,
   *  or it exists but isn't owned by userId (caller-facing 404). */
  getOwned(id: string, userId: string): QuizRow | undefined;
  /** Unchecked lookup by id — backs results reads the SERVICE has already
   *  ownership-checked via getOwned. */
  getById(id: string): QuizRow | undefined;
  insert(row: QuizRow, works?: Map<string, string | null>): void;
  update(id: string, userId: string, patch: { name?: string; data?: string }, works?: Map<string, string | null>): QuizRow | undefined;
  delete(id: string, userId: string): boolean;
  /** Account-deletion eraser — the caller's own quizzes, plays, and answers
   *  go away; the caller's plays on OTHER people's quizzes are unlinked,
   *  not deleted, so leaderboards keep their rows (tierlists' precedent). */
  deleteUserData(userId: string): void;
  rekeyBooks(userId: string, fromKeys: string[], toKey: string, toWork: string | null): void;
  storedWorks(quizId: string): Map<string, string | null>;

  /** Lookup by public code — NOT ownership-checked: this backs the public
   *  play routes, where the caller may have no session at all. */
  getByVoteCode(code: string): QuizRow | undefined;
  /** Publish: store the generated question set, mint the code, open play —
   *  one UPDATE, so a quiz can never be half-published. */
  publish(id: string, userId: string, data: string, code: string): QuizRow | undefined;
  setPlayOpen(id: string, userId: string, open: number): QuizRow | undefined;

  getPlayById(quizId: string, playId: string): PlayRow | undefined;
  getPlayByVoter(quizId: string, voterUserId: string): PlayRow | undefined;
  /** Insert a play and its answers in one transaction. A play is never
   *  updated — submission is final. */
  savePlay(play: PlayRow, answers: AnswerRow[]): void;
  getAnswers(playId: string): AnswerRow[];
  /** Leaderboard order: score DESC, then faster duration wins ties. */
  listPlays(quizId: string): PlayRow[];
  playCount(quizId: string): number;
  questionStats(quizId: string): QuestionStat[];
  listParticipation(ownerUserId: string, since: string): Array<{ id: string; name: string; participants: number; latest_at: string }>;
  listRecentPlayers(quizId: string, ownerUserId: string, limit: number): Array<{ user_id: string; at: string }>;
}
