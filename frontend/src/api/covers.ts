import { createCoverResolver, type CoverCacheEntry, type CoverLookupParams, type CoverSize, type ResolvedCoverResponse } from "@scripta/shared";
import { apiFetch } from "./client";

export type ResolveCoverParams = CoverLookupParams;

const STORAGE_KEY = "scripta.covers.resolved.v2";

function loadPersisted(): Record<string, CoverCacheEntry> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CoverCacheEntry>) : {};
  } catch {
    return {};
  }
}

const resolver = createCoverResolver({
  fetchResolve: async (query) => (await apiFetch(`/covers/resolve?${query}`)) as ResolvedCoverResponse,
  persist(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      return;
    }
  }
});
resolver.hydrate(loadPersisted());

export function peekResolvedCover(params: ResolveCoverParams, size: CoverSize = "thumb"): string | null | undefined {
  return resolver.peek(params, size);
}

export function resolveCover(params: ResolveCoverParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null> {
  return resolver.resolve(params, options);
}

export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolver.forget(params);
}

export function rememberResolvedCover(params: ResolveCoverParams, cover: { url: string | null; fullUrl: string | null }): void {
  resolver.remember(params, cover);
}
