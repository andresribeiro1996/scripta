import AsyncStorage from "@react-native-async-storage/async-storage";
import { createCoverResolver, type CoverCacheEntry, type CoverLookupParams, type CoverSize, type ResolvedCoverResponse } from "@scripta/shared";
import { apiClient } from "../../../core/api";

export type ResolveCoverParams = CoverLookupParams;

const STORAGE_KEY = "scripta.covers.resolved.v2";

const resolver = createCoverResolver({
  fetchResolve: (query) => apiClient.request<ResolvedCoverResponse>(`/covers/resolve?${query}`, { auth: true }),
  persist(entries) {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => undefined);
  }
});

let hydratePromise: Promise<void> | null = null;

export function ensureCoversHydrated(): Promise<void> {
  hydratePromise ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (raw) resolver.hydrate(JSON.parse(raw) as Record<string, CoverCacheEntry>);
    })
    .catch(() => undefined);
  return hydratePromise;
}
void ensureCoversHydrated();

export function peekResolvedCover(params: ResolveCoverParams, size: CoverSize = "thumb"): string | null | undefined {
  return resolver.peek(params, size);
}

export function resolveCover(params: ResolveCoverParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null> {
  return resolver.resolve(params, options);
}

export function forgetResolvedCover(params: ResolveCoverParams): void {
  resolver.forget(params);
}
