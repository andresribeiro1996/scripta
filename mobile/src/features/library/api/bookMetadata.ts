import { normalizeIsbn, type BookMetadata } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export async function fetchBookMetadata(book: Record<string, unknown>): Promise<BookMetadata | null> {
  const isbn = normalizeIsbn(book.ISBN);
  const title = String(book.Title ?? "");
  const author = String(book.Attribution ?? "");
  if (!isbn && (!title || !author)) return null;
  const query = new URLSearchParams();
  if (isbn) query.set("isbn", isbn);
  if (title) query.set("title", title);
  if (author) query.set("author", author);
  return (await apiClient.request<{ metadata: BookMetadata | null }>(`/books/details?${query}`, { auth: true })).metadata;
}
