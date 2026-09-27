import type { BookSearchResult } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export type { BookSearchResult } from "@scripta/shared";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  return (await apiClient.request<{ results: BookSearchResult[] }>(`/books/search?${new URLSearchParams({ q: trimmed })}`, { auth: true })).results;
}
