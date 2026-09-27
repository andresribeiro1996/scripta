// Thin apiFetch/publicFetch wrappers over the quizzes module's REST routes
// (backend's modules/quizzes/routes.ts) — same "one function per backend
// route, no client-side logic" shape as api/tierlists.ts. Quiz book and
// question types come from @scripta/shared, where the draw and grading
// logic they mirror live.

import { getSession } from "../auth/tokenStore";
import { apiFetch, publicFetch } from "./client";
import type { PublicQuizQuestion, QuestionStat, QuizData, ResultPlay } from "@scripta/shared";

export type { PublicQuizQuestion, QuestionStat, QuizData, ResultPlay };

export interface Quiz {
  id: string;
  name: string;
  data: QuizData;
  voteCode: string | null;
  playOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlayBoard {
  name: string;
  sourceLabel: string;
  questionCount: number;
  playOpen: boolean;
  playCount: number;
  questions: PublicQuizQuestion[];
}

export interface PlayResponse {
  playId: string;
  score: number;
  correct: Record<string, boolean>;
}

/** Play routes are public, but a caller WITH a session must still send its
 *  token: the backend's one-play-per-account dedupe only engages when the
 *  request identifies a user (same split as tierlistVoting's ballotFetch). */
async function playFetch(path: string, init?: RequestInit): Promise<unknown> {
  return (getSession() ? apiFetch : publicFetch)(path, init);
}

export async function fetchQuizzes(): Promise<Quiz[]> {
  const body = (await apiFetch("/quizzes")) as { quizzes: Quiz[] };
  return body.quizzes;
}

export async function fetchQuiz(id: string): Promise<Quiz> {
  return (await apiFetch(`/quizzes/${id}`)) as Quiz;
}

export async function createQuizApi(name: string, data: QuizData): Promise<Quiz> {
  return (await apiFetch("/quizzes", { method: "POST", body: JSON.stringify({ name, data }) })) as Quiz;
}

export async function updateQuizApi(id: string, patch: { name?: string; data?: QuizData }): Promise<Quiz> {
  return (await apiFetch(`/quizzes/${id}`, { method: "PUT", body: JSON.stringify(patch) })) as Quiz;
}

export async function deleteQuizApi(id: string): Promise<void> {
  await apiFetch(`/quizzes/${id}`, { method: "DELETE" });
}

export async function publishQuizApi(id: string): Promise<{ quiz: Quiz; voteCode: string }> {
  return (await apiFetch(`/quizzes/${id}/publish`, { method: "POST" })) as { quiz: Quiz; voteCode: string };
}

export async function setPlayStateApi(id: string, open: boolean): Promise<Quiz> {
  const body = (await apiFetch(`/quizzes/${id}/voting`, { method: "PUT", body: JSON.stringify({ open }) })) as { quiz: Quiz };
  return body.quiz;
}

export async function fetchQuizResultsApi(id: string): Promise<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }> {
  return (await apiFetch(`/quizzes/${id}/results`)) as { plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number };
}

export async function fetchPlayBoard(code: string): Promise<PlayBoard> {
  const body = (await publicFetch(`/quizzes/voting/${encodeURIComponent(code)}`)) as { board: PlayBoard };
  return body.board;
}

export async function submitPlayApi(
  code: string,
  body: { answers: Array<{ questionId: string; choiceIndex: number }>; durationMs: number; playerName?: string }
): Promise<PlayResponse> {
  return (await playFetch(`/quizzes/voting/${encodeURIComponent(code)}/play`, { method: "POST", body: JSON.stringify(body) })) as PlayResponse;
}

/** A null playId asks for the signed-in account's own play (the only way
 *  a signed-in player can recover it — no id is ever stored for them); an
 *  anonymous player passes the id their browser stored at submit. */
export async function fetchPlayApi(code: string, playId: string | null): Promise<PlayResponse> {
  const encodedCode = encodeURIComponent(code);
  const path = playId === null ? `/quizzes/voting/${encodedCode}/play` : `/quizzes/voting/${encodedCode}/play/${encodeURIComponent(playId)}`;
  return (await playFetch(path)) as PlayResponse;
}

export async function fetchPublicResultsApi(code: string): Promise<{ plays: Array<Omit<ResultPlay, "playId">>; questionCount: number }> {
  return (await publicFetch(`/quizzes/voting/${encodeURIComponent(code)}/results`)) as { plays: Array<Omit<ResultPlay, "playId">>; questionCount: number };
}
