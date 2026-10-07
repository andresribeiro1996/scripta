import { createQuizzesApi } from "@scripta/shared";
import { request } from "../../core/api";

export type { PlayBoard, PlayResponse, PlaySubmission, PublicResultPlay, Quiz } from "@scripta/shared";

export const {
  fetchQuizzes,
  fetchQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  publishQuiz,
  setPlayState,
  fetchQuizResults,
  fetchPlayBoard,
  submitPlay,
  fetchPlay,
  fetchPublicResults,
} = createQuizzesApi(request);
