import { workIdOf } from "@scripta/shared";

export function booksByWork(books: Array<Record<string, unknown>>): Map<string, Record<string, unknown>> {
  const byWork = new Map<string, Record<string, unknown>>();
  for (const book of books) {
    const workId = workIdOf(book);
    if (workId && !byWork.has(workId)) byWork.set(workId, book);
  }
  return byWork;
}
