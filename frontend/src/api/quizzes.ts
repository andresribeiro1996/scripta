import { createQuizzesApi } from "@scripta/shared";
import { request } from "./request";

export type { PlayBoard, PlayResponse, PublicQuizQuestion, QuestionStat, Quiz, QuizData, ResultPlay } from "@scripta/shared";

export const {
  fetchQuizzes,
  fetchQuiz,
  createQuiz: createQuizApi,
  updateQuiz: updateQuizApi,
  deleteQuiz: deleteQuizApi,
  publishQuiz: publishQuizApi,
  setPlayState: setPlayStateApi,
  fetchQuizResults: fetchQuizResultsApi,
  fetchPlayBoard,
  submitPlay: submitPlayApi,
  fetchPlay: fetchPlayApi,
  fetchPublicResults: fetchPublicResultsApi,
} = createQuizzesApi(request);
