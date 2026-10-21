import { normalizeBookGenres, workGenres, type WorkGenres } from "@scripta/shared";
import { findOrCreateBook } from "./domain/findOrCreate.js";
import { searchTokens, WORK_SCAN_LIMIT, type BookLookup } from "./domain/normalize.js";
import type { SeriesEntry } from "./domain/series.js";
import { hiddenSynopsisHashes } from "./domain/synopsis.js";
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
  series?: SeriesEntry | null;
  editions: Array<{ bookId: string; title: string; language: string | null; year: number | null; isbn: string | null; summary: string | null; coverUrl: string | null; coverColor: string | null; genres: string[]; rating: number | null; ratingCount: number; pages: number | null; possible?: boolean; collection?: SeriesEntry | null }>;
};

export function getWorkPageWith(books: BooksRepository, coverUrl: (imageId: string) => string, id: string): CatalogWorkPage | undefined {
  const rows = books.workPageRows(id);
  if (!rows) return undefined;
  const hidden = hiddenSynopsisHashes(books, [rows.work.summary_hash, ...rows.editions.map((edition) => edition.summary_hash)]);
  const shown = (text: string | null, hash: string | null) => (text?.trim() && !(hash !== null && hidden.has(hash)) ? text : null);
  const series = books.bestSeriesOf([rows.work.id]).get(rows.work.id) ?? null;
  const collections = books.collectionsOf(rows.editions.map((edition) => edition.id));
  return {
    id: rows.work.id,
    title: rows.work.title,
    author: rows.work.author,
    summary: shown(rows.work.summary, rows.work.summary_hash),
    aliasIds: rows.aliasIds,
    series,
    editions: rows.editions.map((edition) => ({
      bookId: edition.id,
      title: edition.title,
      language: edition.language,
      year: edition.year,
      isbn: edition.isbn,
      summary: shown(edition.summary, edition.summary_hash),
      coverUrl: edition.cover_image_id ? coverUrl(edition.cover_image_id) : null,
      coverColor: edition.cover_color || null,
      genres: normalizeBookGenres(JSON.parse(edition.genres)),
      rating: edition.rating,
      ratingCount: edition.rating_count,
      pages: edition.pages,
      possible: isPossibleGenre(edition.genres_source, edition.genres_confidence),
      collection: collections.get(edition.id) ?? null
    }))
  };
}

export function getWorkPage(id: string): CatalogWorkPage | undefined {
  return getWorkPageWith(booksRepository(), (imageId) => coverUrlFor(imageId, "file"), id);
}

export const CONFIDENT_GENRE_LINE = 0.8;

export function isPossibleGenre(source: string | null, confidence: number | null): boolean {
  return source === "jev" && (confidence ?? 0) < CONFIDENT_GENRE_LINE;
}

export function catalogGenresWith(books: BooksRepository, workIds: string[]): Map<string, WorkGenres> {
  const byWork = new Map<string, Array<{ genres: string[]; possible: boolean }>>();
  for (const row of workIds.length === 0 ? [] : books.editionGenres(workIds)) {
    const editions = byWork.get(row.work_id) ?? [];
    editions.push({ genres: normalizeBookGenres(JSON.parse(row.genres)), possible: isPossibleGenre(row.genres_source, row.genres_confidence) });
    byWork.set(row.work_id, editions);
  }
  return new Map([...byWork].map(([workId, editions]) => [workId, workGenres(editions)]));
}

export function catalogGenres(workIds: string[]): Map<string, WorkGenres> {
  return catalogGenresWith(booksRepository(), workIds);
}
