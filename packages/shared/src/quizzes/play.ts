import type { PublicQuizQuestion, SubmittedAnswer } from "./types.js";

export function buildSubmission(questions: PublicQuizQuestion[], answers: Record<string, number>): Array<SubmittedAnswer> {
  return questions.map((question) => ({ questionId: question.id, choiceIndex: answers[question.id] ?? 0 }));
}

export function isComplete(questions: PublicQuizQuestion[], answers: Record<string, number>): boolean {
  return questions.every((question) => answers[question.id] !== undefined);
}

export function nextIndex(questions: PublicQuizQuestion[], index: number): number {
  return Math.min(index + 1, questions.length - 1);
}

export type PlayStage = "loading" | "unavailable" | "leaderboard" | "played" | "playing";

export function playStage(input: {
  boardReady: boolean;
  boardMissing: boolean;
  playOpen: boolean;
  resolved: boolean;
  alreadyPlayed: boolean;
}): PlayStage {
  if (input.boardMissing) return "unavailable";
  if (!input.boardReady) return "loading";
  if (!input.resolved) return "loading";
  if (input.alreadyPlayed) return "played";
  return input.playOpen ? "playing" : "leaderboard";
}
