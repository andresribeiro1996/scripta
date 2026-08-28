import { apiFetch } from "./client";

export interface ResolveCoverParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

/** The whole cover-resolution chain now lives server-side (see
 *  backend/src/modules/covers) — Kobo CDN, Open Library, Google Books,
 *  and Hardcover, PLUS a global cache checked before any of them, shared
 *  by every account on this install. This is the one call `CoverImage`
 *  (`BookCard.tsx`) makes for a book with no `_coverUrl` of its own
 *  (a custom gallery cover, or legacy data from before this cache
 *  existed) — everything about WHICH source it came from and whether it
 *  needed to actually reach out to Kobo/Open Library/Google/Hardcover at
 *  all is the backend's concern now, not this app's. Resolves to `null`
 *  when nothing anywhere has a cover for this book — a legitimate
 *  answer, not a thrown error (the backend's own route never errors on
 *  a genuine miss; only a real failure — network, auth, a malformed
 *  request — throws here, same `ApiError` every other apiFetch call can
 *  throw). */
export async function resolveCover(params: ResolveCoverParams): Promise<string | null> {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.imageId) query.set("imageId", params.imageId);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  const body = (await apiFetch(`/covers/resolve?${query.toString()}`)) as { url: string | null };
  return body.url;
}
