import { queryOptions } from "@tanstack/react-query";
import { normalizeIsbn } from "./covers";
import { validBookRating, type BookMetadata } from "@scripta/shared";
import { apiFetch } from "../api/client";

export type { BookMetadata };
export { validBookRating };

export async function fetchBookMetadata(isbn: string, title: string, author: string, signal?: AbortSignal): Promise<BookMetadata | null> {
  if (!isbn && (!title || !author)) return null;
  const query = new URLSearchParams();
  if (isbn) query.set("isbn", isbn);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  const body = (await apiFetch(`/books/details?${query}`, { signal })) as { metadata: BookMetadata | null };
  return body.metadata;
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

export function summarySourceName(data: BookMetadata): string {
  if (data.summarySource === "publisher") return data.publisher ?? "Publisher";
  return data.summarySource === "isbndb" ? "ISBNdb" : "Open Library";
}
