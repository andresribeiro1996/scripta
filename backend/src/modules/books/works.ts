import { findOrCreateBook } from "./domain/findOrCreate.js";
import type { BookLookup } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";
import { booksRepository } from "./publicCoverLookup.js";

export type WorkLookup = BookLookup;

export function canonicalWorksWith(books: BooksRepository, ids: string[]): Map<string, string> {
  return ids.length === 0 ? new Map() : books.canonicalWorkIds(ids);
}

export function resolveWorksWith(books: BooksRepository, lookups: WorkLookup[]): Array<string | null> {
  const createdAt = new Date().toISOString();
  const ids = books.transaction(() => lookups.map((lookup) => {
    const book = findOrCreateBook(books, lookup, createdAt);
    return book ? book.work_id ?? books.assignWork(book.id) : null;
  }));
  const canonical = canonicalWorksWith(books, ids.filter((id): id is string => id !== null));
  return ids.map((id) => (id ? canonical.get(id) ?? id : null));
}

export function resolveWorks(lookups: WorkLookup[]): Array<string | null> {
  return resolveWorksWith(booksRepository(), lookups);
}

export function canonicalWorks(ids: string[]): Map<string, string> {
  return canonicalWorksWith(booksRepository(), ids);
}
