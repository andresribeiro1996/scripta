import {
  coverCandidatesQuery,
  coverQueryKey,
  createCoverResolver,
  pickCoverBody,
  type CoverCacheEntry,
  type CoverCandidatesResponse,
  type CoverChoice,
  type CoverLookupParams,
  type CoverPickSource,
  type CoverSize,
  type ResolvedCoverResponse
} from "@scripta/shared";
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
  fetchResolveBatch: async (lookups) =>
    ((await apiFetch("/covers/resolve/batch", { method: "POST", body: JSON.stringify(lookups) })) as { results: ResolvedCoverResponse[] }).results,
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

const rememberListeners = new Set<(key: string) => void>();

export function subscribeResolvedCovers(listener: (key: string) => void): () => void {
  rememberListeners.add(listener);
  return () => {
    rememberListeners.delete(listener);
  };
}

export function rememberResolvedCover(params: ResolveCoverParams, cover: { url: string | null; fullUrl: string | null }): void {
  resolver.remember(params, cover);
  const key = coverQueryKey(params);
  for (const listener of rememberListeners) listener(key);
}

export async function fetchCoverCandidates(params: ResolveCoverParams, from: CoverPickSource): Promise<CoverCandidatesResponse> {
  return (await apiFetch(`/covers/candidates?${coverCandidatesQuery(params, from)}`)) as CoverCandidatesResponse;
}

export async function pickCover(params: ResolveCoverParams, choice: CoverChoice, everyone: boolean): Promise<ResolvedCoverResponse> {
  return (await apiFetch("/covers/pick", { method: "POST", body: JSON.stringify(pickCoverBody(params, choice, everyone)) })) as ResolvedCoverResponse;
}
