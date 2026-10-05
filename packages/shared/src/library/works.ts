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
