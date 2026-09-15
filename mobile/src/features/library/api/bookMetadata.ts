import { buildBookMetadata, findOpenLibraryMatch, normalizeIsbn, type BookMetadata } from "@scripta/shared";

export async function fetchBookMetadata(book: Record<string, unknown>, signal?: AbortSignal): Promise<BookMetadata | null> {
  const isbn = normalizeIsbn(book.ISBN);
  const title = String(book.Title ?? "");
  const author = String(book.Attribution ?? "");
  if (!isbn && (!title || !author)) return null;
  const query = new URLSearchParams({ fields: "key,title,author_name,ratings_average,ratings_count,subject", limit: "5" });
  if (isbn) query.set("isbn", isbn);
  else { query.set("title", title); query.set("author", author); }
  const response = await fetch(`https://openlibrary.org/search.json?${query}`, { signal });
  if (!response.ok) throw new Error("Book information is unavailable.");
  const match = findOpenLibraryMatch(await response.json(), isbn, title, author);
  if (!match) return null;
  const workResponse = await fetch(`https://openlibrary.org${String(match.key)}.json`, { signal });
  if (!workResponse.ok) throw new Error("Book information is unavailable.");
  return buildBookMetadata(match, await workResponse.json());
}
