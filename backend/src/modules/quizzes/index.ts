// Public interface of the quizzes module. Everything else in
// modules/quizzes/ is private implementation — same convention as
// modules/tierlists/index.ts.

export { quizzesPlugin as registerQuizzesModule, deleteQuizzesUserData, getQuizzesPublicApi } from "./plugin.js";
export type { GameByWork, QuizzesPublicApi } from "./service.js";
