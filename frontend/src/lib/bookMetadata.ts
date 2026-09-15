// The `BookMetadata` shape and `validBookRating` moved to
// packages/shared/src/library/bookMetadata.ts (Task 3A) — re-exported
// here so every existing `from "./lib/bookMetadata"` import keeps
// working unchanged. `fetchBookMetadata` (an Open Library network call)
// and `bookMetadataOptions` (a TanStack Query `queryOptions` wrapper)
// stay here — see the shared module's own top comment for why.

import { queryOptions } from "@tanstack/react-query";
import { normalizeIsbn } from "./covers";
import { buildBookMetadata, findOpenLibraryMatch, validBookRating, type BookMetadata } from "@scripta/shared";

export type { BookMetadata };
export { validBookRating };

export async function fetchBookMetadata(isbn: string, title: string, author: string, signal?: AbortSignal): Promise<BookMetadata | null> {
  const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count,subject", limit: "5" });
  if (isbn) query.set("isbn", isbn);
  else {
    if (!title || !author) return null;
    query.set("title", title);
    query.set("author", author);
  }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  const response = await fetch(`https://openlibrary.org/search.json?${query}`, { signal: requestSignal });
  if (!response.ok) throw new Error("Book information is unavailable.");
  const match = findOpenLibraryMatch(await response.json(), isbn, title, author);
  if (!match) return null;
  const sourceUrl = `https://openlibrary.org${String(match.key)}`;
  const workResponse = await fetch(`${sourceUrl}.json`, { signal: requestSignal });
  if (!workResponse.ok) throw new Error("Book summary is unavailable.");
  return buildBookMetadata(match, await workResponse.json());
}

export function bookMetadataOptions(book: Record<string, unknown>) {
  const isbn = normalizeIsbn(book.ISBN);
  const title = String(book.Title ?? "");
  const author = String(book.Attribution ?? "");
  return queryOptions({
    queryKey: ["book-metadata", isbn, title, author],
    queryFn: ({ signal }) => fetchBookMetadata(isbn, title, author, signal),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false
  });
}
