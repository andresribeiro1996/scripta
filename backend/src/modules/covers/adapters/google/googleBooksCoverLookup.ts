// Google Books — ported from the frontend's lib/covers.ts
// (searchGoogleBooksCoverByIsbn/searchGoogleBooksCover). Both genuinely
// need a fetch to Google's own Volumes API first, to discover a
// candidate image URL, before service.ts's shared download step can
// fetch the actual bytes — same two-step shape Open Library's fuzzy
// search has, unlike Kobo/Open Library's ISBN-direct one-request URLs.
//
// Called with no API key here too, same as the frontend — this was the
// source that turned out to hit a real, easily-exhausted shared daily
// quota for unauthenticated traffic (confirmed live: a genuine `429
// rateLimitExceeded`) while building the frontend's own version of this
// chain. That's exactly why it's ordered LAST among the ISBN-based
// attempts in service.ts, same reasoning as there — and now that this
// runs server-side instead of once per browser tab, a cache hit here
// means this quota is spent AT MOST ONCE per book, ever, across every
// account on this install, rather than once per page load per user —
// the single biggest practical relief this whole cache provides for
// Google specifically.

function cleanGoogleBooksImageUrl(url: string): string {
  return url.replace(/^http:/, "https:").replace(/[?&]edge=curl/, "");
}

async function fetchGoogleBooksCoverUrl(query: string): Promise<string | null> {
  try {
    const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`);
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ volumeInfo?: { imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }> };
    const links = data.items?.[0]?.volumeInfo?.imageLinks;
    const url = links?.thumbnail ?? links?.smallThumbnail;
    return url ? cleanGoogleBooksImageUrl(url) : null;
  } catch {
    return null;
  }
}

export function searchGoogleBooksCoverByIsbnUrl(isbn: string): Promise<string | null> {
  return fetchGoogleBooksCoverUrl(`isbn:${isbn}`);
}

export function searchGoogleBooksCoverUrl(title: string, author?: string): Promise<string | null> {
  const query = author ? `intitle:${title} inauthor:${author}` : `intitle:${title}`;
  return fetchGoogleBooksCoverUrl(query);
}
