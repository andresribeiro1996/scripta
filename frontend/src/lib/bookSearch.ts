import type { BookSearchResult } from "@scripta/shared";
import { apiFetch } from "../api/client";

export type { BookSearchResult, ManualBookFields } from "@scripta/shared";
export { looksLikeIsbnQuery, mapOpenLibraryDoc, buildManualBook } from "@scripta/shared";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const body = (await apiFetch(`/books/search?${new URLSearchParams({ q: trimmed })}`)) as { results: BookSearchResult[] };
  return body.results;
}
