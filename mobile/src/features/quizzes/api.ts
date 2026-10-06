import type { PublicQuizQuestion, QuestionStat, QuizData, QuizDataInput, ResultPlay } from "@scripta/shared";
import { apiClient } from "../../core/api";

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

/** Leaderboard rows are public: the backend strips playId (it's an
 *  anonymous player's only recovery handle). */
export type PublicResultPlay = Omit<ResultPlay, "playId">;

export interface SubmissionBody {
  answers: Array<{ questionId: string; choiceIndex: number }>;
  durationMs: number;
  playerName?: string;
}

export async function fetchQuizzes() {
  return (await apiClient.request<{ quizzes: Quiz[] }>("/quizzes", { auth: true })).quizzes;
}

export function fetchQuiz(id: string) {
  return apiClient.request<Quiz>(`/quizzes/${id}`, { auth: true });
}

export function createQuiz(name: string, data: QuizDataInput) {
  return apiClient.request<Quiz>("/quizzes", { method: "POST", body: { name, data }, auth: true });
}

export function updateQuiz(id: string, patch: { name?: string; data?: QuizData }) {
  return apiClient.request<Quiz>(`/quizzes/${id}`, { method: "PUT", body: patch, auth: true });
}

export function deleteQuiz(id: string) {
  return apiClient.request(`/quizzes/${id}`, { method: "DELETE", auth: true });
}

export function publishQuiz(id: string) {
  return apiClient.request<{ quiz: Quiz; voteCode: string }>(`/quizzes/${id}/publish`, { method: "POST", body: {}, auth: true });
}

export async function setPlayState(id: string, open: boolean) {
  return (await apiClient.request<{ quiz: Quiz }>(`/quizzes/${id}/voting`, { method: "PUT", body: { open }, auth: true })).quiz;
}

export function fetchQuizResults(id: string) {
  return apiClient.request<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }>(`/quizzes/${id}/results`, { auth: true });
}

export function fetchPlayBoard(code: string) {
  return apiClient.request<{ board: PlayBoard }>(`/quizzes/voting/${encodeURIComponent(code)}`);
}

export function submitPlay(code: string, body: SubmissionBody, authenticated: boolean) {
  return apiClient.request<PlayResponse>(`/quizzes/voting/${encodeURIComponent(code)}/play`, { method: "POST", body, auth: authenticated });
}

export function fetchPlay(code: string, playId: string | null, authenticated: boolean) {
  const suffix = playId ? `/${encodeURIComponent(playId)}` : "";
  return apiClient.request<PlayResponse>(`/quizzes/voting/${encodeURIComponent(code)}/play${suffix}`, { auth: authenticated });
}

export function fetchPublicResults(code: string) {
  return apiClient.request<{ plays: PublicResultPlay[]; questionCount: number }>(`/quizzes/voting/${encodeURIComponent(code)}/results`);
}
