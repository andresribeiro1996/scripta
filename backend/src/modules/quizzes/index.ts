// Public interface of the quizzes module. Everything else in
// modules/quizzes/ is private implementation — same convention as
// modules/tierlists/index.ts.

export { quizzesPlugin as registerQuizzesModule, deleteQuizzesUserData, getQuizzesPublicApi, rekeyQuizzesBooks } from "./plugin.js";
export type { QuizzesPublicApi } from "./service.js";
export { sweepQuizzesWorks } from "./worksSweep.js";
