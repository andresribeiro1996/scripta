// Mobile's own copy of frontend/src/lib/bookSearch.ts's `searchBooks` —
// the actual Open Library fetch is network-bound and per-client by
// design (see @scripta/shared's bookSearch.ts top comment), and plain
// `fetch`/`URLSearchParams`/`AbortSignal.timeout` all work unchanged
// under Hermes, so this is a straight port, not a rewrite.

import { looksLikeIsbnQuery, mapOpenLibraryDoc, type BookSearchResult } from "@scripta/shared";

export type { BookSearchResult } from "@scripta/shared";

export async function searchBooks(query: string): Promise<BookSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const params = new URLSearchParams({
    fields: "key,title,author_name,first_publish_year,isbn,publisher,cover_i",
    limit: "12",
  });
  if (looksLikeIsbnQuery(trimmed)) params.set("isbn", trimmed.replace(/[\s-]/g, ""));
  else params.set("q", trimmed);
  const response = await fetch(`https://openlibrary.org/search.json?${params}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error("Search is unavailable right now — try again.");
  const data = await response.json();
  const docs = Array.isArray(data?.docs) ? (data.docs as Array<Record<string, unknown>>) : [];
  return docs.map(mapOpenLibraryDoc).filter((r): r is BookSearchResult => r !== null);
}
