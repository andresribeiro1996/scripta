import type { QuizQuestion, SubmittedAnswer } from "./types.js";

export interface GradeResult {
  score: number;
  /** One entry per question in `questions` — the server's verdict on each. */
  correct: Record<string, boolean>;
}

export function gradeAnswers(questions: QuizQuestion[], submitted: SubmittedAnswer[]): GradeResult {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const correct: Record<string, boolean> = {};
  let score = 0;
  for (const q of questions) correct[q.id] = false;
  for (const answer of submitted) {
    const q = byId.get(answer.questionId);
    if (!q) continue;
    const right = answer.choiceIndex === q.answerIndex;
    correct[q.id] = right;
    if (right) score += 1;
  }
  return { score, correct };
}
