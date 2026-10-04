// The cross-client half of frontend's lib/bookMetadata.ts: the
// BookMetadata shape and the rating validator both the detail sheet and
// (eventually) mobile need. The actual fetch (now just GET
// /books/details — the backend does the Open Library lookup) and the
// TanStack Query `queryOptions` wrapper are framework/network-bound —
// they stay in frontend/src/lib/bookMetadata.ts (and their own future
// mobile equivalent), not here.

import { normalizeBookGenres, type BookGenre } from "./bookGenres.js";

export interface BookMetadata {
  summary: string | null;
  rating: number | null;
  ratingCount: number;
  sourceUrl: string;
  genres: BookGenre[];
  pages: number | null;
  publisher: string | null;
  year: number | null;
  translator: string | null;
  summarySource: "publisher" | "openlibrary" | "isbndb" | null;
}

export type CatalogBookMetadata = Omit<BookMetadata, "summarySource">;

export function validBookRating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}

function normalized(value: string) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function findOpenLibraryMatch(data: unknown, isbn: string, title: string, author: string): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const docs = (data as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) return null;
  return docs.find((value): value is Record<string, unknown> => {
    if (!value || typeof value !== "object") return false;
    const doc = value as Record<string, unknown>;
    return typeof doc.key === "string" && /^\/works\/OL\d+W$/.test(doc.key) && (Boolean(isbn) || (
      typeof doc.title === "string" && normalized(doc.title) === normalized(title) && Array.isArray(doc.author_name) &&
      doc.author_name.some((name) => typeof name === "string" && normalized(name) === normalized(author))
    ));
  }) ?? null;
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

export function buildBookMetadata(match: Record<string, unknown>, work: unknown): CatalogBookMetadata {
  const sourceUrl = `https://openlibrary.org${String(match.key)}`;
  const record = work && typeof work === "object" ? work as Record<string, unknown> : {};
  const rawDescription = record.description;
  const description = typeof rawDescription === "string" ? rawDescription : rawDescription && typeof rawDescription === "object" ? (rawDescription as { value?: unknown }).value : null;
  return {
    summary: typeof description === "string" && description.trim() ? description.trim().replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1") : null,
    rating: validBookRating(match.ratings_average),
    ratingCount: typeof match.ratings_count === "number" && Number.isFinite(match.ratings_count) && match.ratings_count > 0 ? Math.floor(match.ratings_count) : 0,
    sourceUrl,
    genres: normalizeBookGenres(record.subjects ?? match.subject),
    pages: null,
    publisher: null,
    year: null,
    translator: null
  };
}
