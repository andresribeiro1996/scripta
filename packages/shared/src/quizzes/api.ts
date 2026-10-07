import { apiPath } from "../api/path.js";
import type { ApiRequest } from "../api/port.js";
import type { PlayBoard, PlayResponse, PlaySubmission, PublicResultPlay, QuestionStat, Quiz, QuizData, QuizDataInput, ResultPlay } from "./types.js";

export function createQuizzesApi(request: ApiRequest) {
  return {
    async fetchQuizzes(): Promise<Quiz[]> {
      return (await request<{ quizzes: Quiz[] }>("/quizzes", { auth: "required" })).quizzes;
    },
    fetchQuiz(id: string): Promise<Quiz> {
      return request<Quiz>(apiPath`/quizzes/${id}`, { auth: "required" });
    },
    createQuiz(name: string, data: QuizDataInput): Promise<Quiz> {
      return request<Quiz>("/quizzes", { method: "POST", body: { name, data }, auth: "required" });
    },
    updateQuiz(id: string, patch: { name?: string; data?: QuizData }): Promise<Quiz> {
      return request<Quiz>(apiPath`/quizzes/${id}`, { method: "PUT", body: patch, auth: "required" });
    },
    async deleteQuiz(id: string): Promise<void> {
      await request(apiPath`/quizzes/${id}`, { method: "DELETE", auth: "required" });
    },
    publishQuiz(id: string): Promise<{ quiz: Quiz; voteCode: string }> {
      return request(apiPath`/quizzes/${id}/publish`, { method: "POST", auth: "required" });
    },
    async setPlayState(id: string, open: boolean): Promise<Quiz> {
      return (await request<{ quiz: Quiz }>(apiPath`/quizzes/${id}/voting`, { method: "PUT", body: { open }, auth: "required" })).quiz;
    },
    fetchQuizResults(id: string): Promise<{ plays: ResultPlay[]; stats: QuestionStat[]; questionCount: number }> {
      return request(apiPath`/quizzes/${id}/results`, { auth: "required" });
    },
    async fetchPlayBoard(code: string): Promise<PlayBoard> {
      return (await request<{ board: PlayBoard }>(apiPath`/quizzes/voting/${code}`, { auth: "none" })).board;
    },
    submitPlay(code: string, body: PlaySubmission): Promise<PlayResponse> {
      return request<PlayResponse>(apiPath`/quizzes/voting/${code}/play`, { method: "POST", body, auth: "optional" });
    },
    fetchPlay(code: string, playId: string | null): Promise<PlayResponse> {
      const path = playId === null ? apiPath`/quizzes/voting/${code}/play` : apiPath`/quizzes/voting/${code}/play/${playId}`;
      return request<PlayResponse>(path, { auth: "optional" });
    },
    fetchPublicResults(code: string): Promise<{ plays: PublicResultPlay[]; questionCount: number }> {
      return request(apiPath`/quizzes/voting/${code}/results`, { auth: "none" });
    },
  };
}

export type QuizzesApi = ReturnType<typeof createQuizzesApi>;
