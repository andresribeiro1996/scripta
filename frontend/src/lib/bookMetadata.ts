// The `BookMetadata` shape and `validBookRating` moved to
// packages/shared/src/library/bookMetadata.ts (Task 3A) — re-exported
// here so every existing `from "./lib/bookMetadata"` import keeps
// working unchanged. `fetchBookMetadata` (an Open Library network call)
// and `bookMetadataOptions` (a TanStack Query `queryOptions` wrapper)
// stay here — see the shared module's own top comment for why.

import { queryOptions } from "@tanstack/react-query";
import { normalizeIsbn } from "./covers";
import { validBookRating, type BookMetadata } from "@scripta/shared";

export type { BookMetadata };
export { validBookRating };

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export async function fetchBookMetadata(isbn: string, title: string, author: string, signal?: AbortSignal): Promise<BookMetadata | null> {
  const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count", limit: "5" });
  if (isbn) query.set("isbn", isbn);
  else {
    if (!title || !author) return null;
    query.set("title", title);
    query.set("author", author);
  }
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  const response = await fetch(`https://openlibrary.org/search.json?${query}`, { signal: requestSignal });
  if (!response.ok) throw new Error("Book information is unavailable.");
  const data = await response.json();
  const match = Array.isArray(data?.docs)
    ? data.docs.find(
        (doc: Record<string, unknown>) =>
          typeof doc?.key === "string" &&
          /^\/works\/OL\d+W$/.test(doc.key) &&
          (isbn ||
            (typeof doc.title === "string" &&
              normalized(doc.title) === normalized(title) &&
              Array.isArray(doc.author_name) &&
              doc.author_name.some((name: unknown) => typeof name === "string" && normalized(name) === normalized(author))))
      )
    : undefined;
  if (!match) return null;
  const result: BookMetadata = {
    summary: null,
    rating: validBookRating(match.ratings_average),
    ratingCount:
      typeof match.ratings_count === "number" && Number.isFinite(match.ratings_count) && match.ratings_count > 0
        ? Math.floor(match.ratings_count)
        : 0,
    sourceUrl: `https://openlibrary.org${match.key}`
  };
  const workResponse = await fetch(`${result.sourceUrl}.json`, { signal: requestSignal });
  if (!workResponse.ok) throw new Error("Book summary is unavailable.");
  const work = await workResponse.json();
  const description = typeof work?.description === "string" ? work.description : work?.description?.value;
  result.summary = typeof description === "string" && description.trim()
    ? description.trim().replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "$1")
    : null;
  return result;
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
