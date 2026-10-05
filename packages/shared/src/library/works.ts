import { bookKey } from "./merge.js";

export function withWorkIds(books: Array<Record<string, unknown>>, works: Record<string, string> | undefined): Array<Record<string, unknown>> {
  return books.map((book) => {
    const workId = works?.[bookKey(book)];
    return workId ? { ...book, _workId: workId } : book;
  });
}

export function workIdOf(book: Record<string, unknown>): string | undefined {
  return typeof book._workId === "string" ? book._workId : undefined;
}

export function booksByWork(books: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const byWork = new Map<string, Record<string, unknown>>();
  for (const book of books) {
    const workId = workIdOf(book);
    if (workId && !byWork.has(workId)) byWork.set(workId, book);
  }
  return byWork;
}
