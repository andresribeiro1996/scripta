// Book search for the Add Book flow (components/AddBookModal.tsx) and
// the mapping from a chosen result to a library book record.
//
// The pure query-shape/result-mapping half (BookSearchResult,
// looksLikeIsbnQuery, mapOpenLibraryDoc, ManualBookFields,
// buildManualBook) moved to packages/shared/src/library/bookSearch.ts
// (Task 3A) — re-exported here so every existing `from "./lib/
// bookSearch"` import keeps working unchanged. `searchBooks` (the actual
// Open Library fetch) stays here — see the shared module's own top
// comment for why.

import { looksLikeIsbnQuery, mapOpenLibraryDoc, type BookSearchResult } from "@scripta/shared";

export type { BookSearchResult, ManualBookFields } from "@scripta/shared";
export { looksLikeIsbnQuery, mapOpenLibraryDoc, buildManualBook } from "@scripta/shared";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({
    fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i",
    limit: "12"
  });
  if (looksLikeIsbnQuery(trimmed)) params.set("isbn", trimmed.replace(/[\s-]/g, ""));
  else params.set("q", trimmed);
  const response = await fetch(`https://openlibrary.org/search.json?${params}`, {
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Search is unavailable right now — try again.");
  const data = await response.json();
  const docs = Array.isArray(data?.docs) ? (data.docs as Array<Record<string, unknown>>) : [];
  return docs.map(mapOpenLibraryDoc).filter((r): r is BookSearchResult => r !== null);
}
