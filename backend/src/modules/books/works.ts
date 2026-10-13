import { normalizeBookGenres } from "@scripta/shared";
import { findOrCreateBook } from "./domain/findOrCreate.js";
import { searchTokens, WORK_SCAN_LIMIT, type BookLookup } from "./domain/normalize.js";
import type { BooksRepository } from "./domain/ports.js";
import { firstEditionPerWork, workIdsOf } from "./domain/workSearch.js";
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

export function matchWorksWith(books: BooksRepository, query: string, limit: number): string[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return [];
  const rows = books.searchBooks(tokens, WORK_SCAN_LIMIT);
  const works = firstEditionPerWork(rows, canonicalWorksWith(books, workIdsOf(rows)))
    .flatMap(({ workId }) => (workId ? [workId] : []))
    .slice(0, limit);
  return works.length === 0 ? [] : [...works, ...books.aliasesOf(works)];
}

export function matchWorks(query: string, limit: number): string[] {
  return matchWorksWith(booksRepository(), query, limit);
}

export type CatalogWorkPage = {
  id: string;
  title: string;
  author: string;
  summary: string | null;
  aliasIds: string[];
  editions: Array<{ bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; coverUrl: string | null; coverColor: string | null; genres: string[]; rating: number | null; ratingCount: number; pages: number | null }>;
};

export function getWorkPageWith(books: BooksRepository, coverUrl: (imageId: string) => string, id: string): CatalogWorkPage | undefined {
  const rows = books.workPageRows(id);
  if (!rows) return undefined;
  return {
    ...rows.work,
    summary: rows.work.summary?.trim() ? rows.work.summary : null,
    aliasIds: rows.aliasIds,
    editions: rows.editions.map((edition) => ({
      bookId: edition.id,
      title: edition.title,
      language: edition.language,
      year: edition.year,
      isbn: edition.isbn,
      summary: edition.summary?.trim() ? edition.summary : null,
      coverUrl: edition.cover_image_id ? coverUrl(edition.cover_image_id) : null,
      coverColor: edition.cover_color || null,
      genres: normalizeBookGenres(JSON.parse(edition.genres)),
      rating: edition.rating,
      ratingCount: edition.rating_count,
      pages: edition.pages
    }))
  };
}

export function getWorkPage(id: string): CatalogWorkPage | undefined {
  return getWorkPageWith(booksRepository(), (imageId) => coverUrlFor(imageId, "file"), id);
}
