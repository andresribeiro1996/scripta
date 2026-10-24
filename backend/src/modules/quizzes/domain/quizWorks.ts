import type { QuizBook, QuizQuestion } from "@scripta/shared";
import type { Quiz } from "./types.js";

export function storedIds(quiz: Quiz): string[] {
  const data = (quiz.data ?? {}) as Record<string, unknown>;
  const stored = Array.isArray(data.books) ? (data.books as QuizBook[]) : [];
  const asked = Array.isArray(data.questions) ? (data.questions as QuizQuestion[]) : [];
  return [...stored.map((book) => book.workId), ...asked.flatMap((question) => (question.workId ? [question.workId] : []))];
}
