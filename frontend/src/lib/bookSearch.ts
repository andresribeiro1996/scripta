import type { BookSearchApi, BookSearchResult } from "@scripta/shared";
import { apiFetch } from "../api/client";

export type { BookSearchResult, ManualBookFields } from "@scripta/shared";
export { looksLikeIsbnQuery, mapOpenLibraryDoc, buildManualBook, searchInsideOutside } from "@scripta/shared";

async function fetchResults(path: string, query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const body = (await apiFetch(`${path}?${new URLSearchParams({ q: trimmed })}`)) as { results: BookSearchResult[] };
  return body.results;
}

export const bookSearchApi: BookSearchApi = {
  inside: (query) => fetchResults("/books/search", query),
  outside: (query) => fetchResults("/books/search/external", query)
};
