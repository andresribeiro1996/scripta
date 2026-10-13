import type { BookSearchApi, BookSearchResult } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export type { BookSearchResult } from "@scripta/shared";

async function fetchResults(path: string, query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await apiClient.request<{ results: BookSearchResult[] }>(`${path}?${new URLSearchParams({ q: trimmed })}`, { auth: true })).results;
}

export const bookSearchApi: BookSearchApi = {
  inside: (query) => fetchResults("/books/search", query),
  outside: (query) => fetchResults("/books/search/external", query),
};

export async function searchCatalogWorks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await apiClient.request<{ results: BookSearchResult[] }>(`/books/search?${new URLSearchParams({ q: trimmed, by: "work" })}`, { auth: true })).results;
}
