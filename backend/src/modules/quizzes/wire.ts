import { canonicalByKey, firstKeyPerWork, keysForWorks, knownWorkIds, resolveTitleWorks } from "../library/index.js";
import type { Quiz, StoredQuizBook, StoredQuizQuestion } from "./domain/types.js";

export function quizToWorks(quiz: Quiz, stored: Map<string, string | null>): Quiz {
  const works = canonicalByKey(stored);
  const data = (quiz.data ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const books = (Array.isArray(data.books) ? (data.books as StoredQuizBook[]) : []).flatMap(({ key, ...book }) => {
    const workId = works.get(key);
    if (!workId || seen.has(workId)) return [];
    seen.add(workId);
    return [{ workId, ...book }];
  });
  const questions = Array.isArray(data.questions)
    ? (data.questions as StoredQuizQuestion[]).map((question) => ({ id: question.id, type: question.type, workId: works.get(question.bookKey) ?? null, options: question.options, answerIndex: question.answerIndex }))
    : data.questions;
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

export function keyedQuizBooks<T extends { workId?: string }>(ownerUserId: string, books: T[], ids: string[], storedKeys: string[], stored: Map<string, string | null>) {
  const keys = keysForWorks(ownerUserId, ids, firstKeyPerWork(storedKeys, canonicalByKey(stored)));
  return {
    books: books.map(({ workId: _workId, ...book }, index) => ({ key: keys.get(ids[index]!)!, ...book })),
    works: new Map<string, string | null>(ids.map((id) => [keys.get(id)!, id]))
  };
}
