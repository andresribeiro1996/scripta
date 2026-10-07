import type { PublicQuizQuestion, SubmittedAnswer } from "@scripta/shared";

export const playStorageKey = (code: string): string => `quiz-play:${code}`;

/** The player's submitted payload: one answer per question, in question
 *  order, defaulting any gap to option 0 (the screen only enables submit
 *  once every question is answered; the default keeps a partial state from
 *  ever producing a malformed body). */
export function buildSubmission(questions: PublicQuizQuestion[], answers: Record<string, number>): Array<SubmittedAnswer> {
  return questions.map((question) => ({ questionId: question.id, choiceIndex: answers[question.id] ?? 0 }));
}

export function isComplete(questions: PublicQuizQuestion[], answers: Record<string, number>): boolean {
  return questions.every((question) => answers[question.id] !== undefined);
}

/** Advance after a pick but clamp to the last question, where the submit
 *  block takes over the footer. */
export function nextIndex(questions: PublicQuizQuestion[], index: number): number {
  return Math.min(index + 1, questions.length - 1);
}

export type PlayStage = "loading" | "unavailable" | "closed" | "played" | "playing";

/** The single decision point the play screen renders from, kept pure. */
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
  return input.playOpen ? "playing" : "closed";
}
