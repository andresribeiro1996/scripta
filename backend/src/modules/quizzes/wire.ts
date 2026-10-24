import type { Quiz as WireQuiz, QuizBook, QuizData, QuizQuestion } from "@scripta/shared";
import { canonicalByKey } from "../library/index.js";
import { storedIds } from "./domain/quizWorks.js";
import type { Quiz } from "./domain/types.js";

export function canonicalForQuiz(quiz: Quiz): Map<string, string> {
  return canonicalByKey(new Map(storedIds(quiz).map((id) => [id, id])));
}

export function quizToWorks(quiz: Quiz, known?: Map<string, string>): WireQuiz {
  const data = (quiz.data ?? {}) as Record<string, unknown>;
  const stored = Array.isArray(data.books) ? (data.books as QuizBook[]) : [];
  const asked = Array.isArray(data.questions) ? (data.questions as QuizQuestion[]) : null;
  const canonical = known ?? canonicalForQuiz(quiz);
  const seen = new Set<string>();
  const books = stored.flatMap((book) => {
    const workId = canonical.get(book.workId)!;
    if (seen.has(workId)) return [];
    seen.add(workId);
    return [{ ...book, workId }];
  });
  const questions = asked ? asked.map((question) => ({ ...question, workId: question.workId ? canonical.get(question.workId)! : null })) : data.questions;
  return { ...quiz, data: { ...data, books, questions } as QuizData };
}
