import { findOrCreateBook } from "./domain/findOrCreate.js";
import type { BookLookup } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";
import { booksRepository, coverUrlFor } from "./publicCoverLookup.js";

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

export type CatalogWorkPage = {
  id: string;
  title: string;
  author: string;
  aliasIds: string[];
  editions: Array<{ bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; coverUrl: string | null }>;
};

export function getWorkPageWith(books: BooksRepository, coverUrl: (imageId: string) => string, id: string): CatalogWorkPage | undefined {
  const rows = books.workPageRows(id);
  if (!rows) return undefined;
  return {
    ...rows.work,
    aliasIds: rows.aliasIds,
    editions: rows.editions.map((edition) => ({
      bookId: edition.id,
      title: edition.title,
      language: edition.language,
      year: edition.year,
      isbn: edition.isbn,
      summary: edition.summary?.trim() ? edition.summary : null,
      coverUrl: edition.cover_image_id ? coverUrl(edition.cover_image_id) : null
    }))
  };
}

export function getWorkPage(id: string): CatalogWorkPage | undefined {
  return getWorkPageWith(booksRepository(), (imageId) => coverUrlFor(imageId, "file"), id);
}
