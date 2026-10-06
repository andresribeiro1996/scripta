import type { QuizBook, QuizQuestion } from "@scripta/shared";
import { canonicalByKey, knownWorkIds, resolveTitleWorks } from "../library/index.js";
import type { Quiz } from "./domain/types.js";

export function quizToWorks(quiz: Quiz): Quiz {
  const data = (quiz.data ?? {}) as Record<string, unknown>;
  const stored = Array.isArray(data.books) ? (data.books as QuizBook[]) : [];
  const asked = Array.isArray(data.questions) ? (data.questions as QuizQuestion[]) : null;
  const ids = [...stored.map((book) => book.workId), ...(asked ?? []).flatMap((question) => (question.workId ? [question.workId] : []))];
  const canonical = canonicalByKey(new Map(ids.map((id) => [id, id])));
  const seen = new Set<string>();
  const books = stored.flatMap((book) => {
    const workId = canonical.get(book.workId)!;
    if (seen.has(workId)) return [];
    seen.add(workId);
    return [{ ...book, workId }];
  });
  const questions = asked ? asked.map((question) => ({ ...question, workId: question.workId ? canonical.get(question.workId)! : null })) : data.questions;
  return { ...quiz, data: { ...data, books, questions } };
}

export function quizBookWorks(books: Array<{ workId?: string; title: string; author: string }>): Array<string | null> {
  const given = [...new Set(books.flatMap((book) => (book.workId ? [book.workId] : [])))];
  const canonical = knownWorkIds(given);
  const known = new Map(given.map((id, index) => [id, canonical[index]!]));
  const titled = books.filter((book) => !book.workId);
  const resolved = resolveTitleWorks(titled);
  const byBook = new Map(titled.map((book, index) => [book, resolved[index] ?? null]));
  return books.map((book) => (book.workId ? known.get(book.workId)! : byBook.get(book) ?? null));
}
