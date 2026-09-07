// Mirrors frontend/src/api/covers.ts — the one call CoverImage makes for
// a book with no `_coverUrl` of its own. The whole resolution chain
// (Kobo CDN, Open Library, Google Books, Hardcover, plus a global cache
// checked before any of them) lives server-side (backend/src/modules/
// covers); this is just the client-side memoization so a remounted list
// doesn't re-ask per book on every navigation. AsyncStorage stands in for
// the web client's localStorage — same "URLs persist, misses don't"
// policy (a miss today may gain a cover tomorrow; a resolved URL is
// immutable).

import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiClient } from "../../../core/api";

export interface ResolveCoverParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

const STORAGE_KEY = "scripta.covers.resolved.v1";

const resolved = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  if (!hydratePromise) {
    hydratePromise = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, string>;
          for (const [key, url] of Object.entries(parsed)) resolved.set(key, url);
        }
      } catch {
        // Corrupt/unavailable storage — the in-memory cache still works
        // for this session.
      } finally {
        hydrated = true;
      }
    })();
  }
  return hydratePromise;
}
// Fire-and-forget at module load — callers that need the persisted cache
// synchronously available use ensureHydrated() below; peekResolvedCover
// itself stays synchronous (matching the web client's API) and simply
// misses until this resolves.
void hydrate();

function persist() {
  const urlsOnly = Object.fromEntries([...resolved].filter(([, url]) => url !== null));
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(urlsOnly)).catch(() => {
    // Storage full or unavailable — the in-memory cache still works.
  });
}

function keyFor(params: ResolveCoverParams): string {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.imageId) query.set("imageId", params.imageId);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query.toString();
}

/** Resolves once the persisted cache has been read, if it hasn't already
 *  — call this before the first render that needs peekResolvedCover to
 *  reflect anything saved from a previous launch (see CoverImage.tsx). */
export function ensureCoversHydrated(): Promise<void> {
  return hydrate();
}

export function peekResolvedCover(params: ResolveCoverParams): string | null | undefined {
  return resolved.get(keyFor(params));
}

export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolved.delete(keyFor(params));
  persist();
}

export async function resolveCover(params: ResolveCoverParams): Promise<string | null> {
  const key = keyFor(params);
  if (resolved.has(key)) return resolved.get(key)!;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const body = await apiClient.request<{ url: string | null }>(`/covers/resolve?${key}`, { auth: true });
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
