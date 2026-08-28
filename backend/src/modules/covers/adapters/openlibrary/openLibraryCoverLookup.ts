// Open Library — ported from the frontend's lib/covers.ts
// (openLibraryCoverUrl/searchOpenLibraryCover). Two genuinely different
// kinds of lookup, same as there:
//
// - openLibraryCoverUrl: a plain, synchronous URL builder for the
//   ISBN-keyed cover — same reasoning koboCoverLookup.ts gives for being
//   fetch-free: the URL and the image bytes are one request, so
//   service.ts's own shared download step is the only fetch needed.
// - searchOpenLibraryCoverUrl: genuinely needs its OWN fetch first, to
//   Open Library's search index, before any image URL is even known —
//   the fuzzy title+author fallback for books with no ISBN/Kobo imageId
//   at all (or whose ISBN-keyed cover 404'd).

// Large for BOTH the ISBN-direct and the fuzzy-search result — a
// deliberate divergence from the frontend's own lib/covers.ts, which
// keeps its fuzzy match at the cheaper "-M" specifically because it
// re-runs that same search on every single page load with no caching.
// Once cached here, a fuzzy hit is a ONE-TIME download (this whole
// module's reason to exist), so there's no repeated-cost argument left
// for settling for the smaller size — may as well cache the better one.
const OPEN_LIBRARY_COVER_SIZE = "L";

export function openLibraryCoverUrl(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-${OPEN_LIBRARY_COVER_SIZE}.jpg?default=false`;
}

export async function searchOpenLibraryCoverUrl(title: string, author?: string): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("title", title);
  if (author) params.set("author", author);
  params.set("limit", "1");
  params.set("fields", "cover_i");
  try {
    const res = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { docs?: Array<{ cover_i?: number }> };
    const coverId = data.docs?.[0]?.cover_i;
    return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-${OPEN_LIBRARY_COVER_SIZE}.jpg` : null;
  } catch {
    return null;
  }
}
