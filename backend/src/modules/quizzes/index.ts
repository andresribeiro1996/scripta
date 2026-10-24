// Public interface of the quizzes module. Everything else in
// modules/quizzes/ is private implementation — same convention as
// modules/tierlists/index.ts.

export { quizzesPlugin as registerQuizzesModule, deleteQuizzesUserData, getQuizzesPublicApi } from "./plugin.js";
export type { PublishedQuizRef, QuizDiscoverRef, QuizzesPublicApi } from "./service.js";
import { createQuizGameSource } from "./adapters/communityGameSource.js";
import { getQuizzesPublicApi } from "./plugin.js";
import type { GameSource } from "../community/index.js";

let cachedGameSource: GameSource<"quiz"> | null = null;

export function getQuizGameSource(): GameSource<"quiz"> {
  return (cachedGameSource ??= createQuizGameSource(getQuizzesPublicApi()));
}
