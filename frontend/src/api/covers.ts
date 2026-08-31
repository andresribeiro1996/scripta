import { apiFetch } from "./client";

export interface ResolveCoverParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

const STORAGE_KEY = "scripta.covers.resolved.v1";

const resolved = new Map<string, string | null>(loadPersisted());
const inFlight = new Map<string, Promise<string | null>>();

function loadPersisted(): [string, string | null][] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string | null>;
    return Object.entries(parsed);
  } catch {
    return [];
  }
}

function persist() {
  try {
    // `null` answers stay memory-only: the backend deliberately never
    // caches misses server-side (a book with no cover today may gain one
    // tomorrow), so a fresh page load re-asks them exactly once per
    // session while SPA navigation still reads the in-memory entry.
    const urlsOnly = Object.fromEntries([...resolved].filter(([, url]) => url !== null));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(urlsOnly));
  } catch {
    // Storage full or unavailable — the in-memory cache still works.
  }
}

function keyFor(params: ResolveCoverParams): string {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.imageId) query.set("imageId", params.imageId);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query.toString();
}

/** Synchronous read of the local resolved-cover cache. Returns `undefined`
 *  when nothing is cached for these params yet, `null` when a definitive
 *  "no cover anywhere" answer is cached. */
export function peekResolvedCover(params: ResolveCoverParams): string | null | undefined {
  return resolved.get(keyFor(params));
}

/** Evicts a cached answer (a stale URL that failed to load), so the next
 *  mount asks the backend again instead of replaying the broken entry. */
export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolved.delete(keyFor(params));
  persist();
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
 *  throw).
 *
 *  Answers are cached locally (memory + localStorage, see above): the
 *  backend-cached files this usually returns are immutable, so a
 *  remounted Library can render every `<img>` immediately instead of
 *  re-round-tripping /covers/resolve per book on every navigation. A
 *  network error still throws and is never cached; a definitive `null`
 *  IS cached, so known misses aren't re-asked either. */
export async function resolveCover(params: ResolveCoverParams): Promise<string | null> {
  const key = keyFor(params);
  if (resolved.has(key)) return resolved.get(key)!;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const body = (await apiFetch(`/covers/resolve?${key}`)) as { url: string | null };
    resolved.set(key, body.url);
    persist();
    return body.url;
  })();
  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}
