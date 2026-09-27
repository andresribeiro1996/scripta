export interface CoverLookupParams {
  isbn?: string;
  imageId?: string;
  title?: string;
  author?: string;
}

export interface ResolvedCoverResponse {
  url: string | null;
  fullUrl: string | null;
  pending: boolean;
}

export interface CoverCacheEntry {
  url: string | null;
  fullUrl: string | null;
  at: number;
}

export type CoverSize = "thumb" | "full";

export const COVER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const COVER_POLL_MAX_ATTEMPTS = 10;
const COVER_POLL_BASE_MS = 5_000;
const COVER_POLL_CAP_MS = 300_000;

export function coverPollDelayMs(attempt: number): number {
  return Math.min(COVER_POLL_BASE_MS * 2 ** attempt, COVER_POLL_CAP_MS);
}

export function coverQueryKey(params: CoverLookupParams): string {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query.toString();
}

export interface CoverResolverDeps {
  fetchResolve(query: string): Promise<ResolvedCoverResponse>;
  persist(entries: Record<string, CoverCacheEntry>): void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface CoverResolver {
  hydrate(saved: Record<string, CoverCacheEntry>): void;
  peek(params: CoverLookupParams, size?: CoverSize): string | null | undefined;
  resolve(params: CoverLookupParams, options?: { size?: CoverSize; poll?: boolean }): Promise<string | null>;
  forget(params: CoverLookupParams): void;
  remember(params: CoverLookupParams, cover: { url: string | null; fullUrl: string | null }): void;
}

export function createCoverResolver(deps: CoverResolverDeps): CoverResolver {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = new Map<string, CoverCacheEntry>();
  const inFlight = new Map<string, Promise<CoverCacheEntry | null>>();

  const fresh = (entry: CoverCacheEntry | undefined) => (entry && now() - entry.at < COVER_CACHE_TTL_MS ? entry : undefined);
  const pick = (entry: CoverCacheEntry, size: CoverSize) => (size === "full" ? entry.fullUrl ?? entry.url : entry.url);

  function persist() {
    deps.persist(Object.fromEntries([...entries].filter(([, entry]) => entry.url !== null)));
  }

  function store(key: string, cover: { url: string | null; fullUrl: string | null }): CoverCacheEntry {
    const entry = { url: cover.url, fullUrl: cover.fullUrl, at: now() };
    entries.set(key, entry);
    persist();
    return entry;
  }

  return {
    hydrate(saved) {
      for (const [key, entry] of Object.entries(saved)) {
        if (!entries.has(key) && typeof entry?.url === "string" && fresh(entry)) entries.set(key, entry);
      }
    },

    peek(params, size = "thumb") {
      const entry = fresh(entries.get(coverQueryKey(params)));
      return entry ? pick(entry, size) : undefined;
    },

    async resolve(params, { size = "thumb", poll = true } = {}) {
      const key = coverQueryKey(params);
      const cached = fresh(entries.get(key));
      if (cached) return pick(cached, size);

      const flightKey = poll ? key : `${key}#once`;
      let request = inFlight.get(flightKey);
      if (!request) {
        request = (async () => {
          try {
            for (let attempt = 0; ; attempt++) {
              const body = await deps.fetchResolve(key);
              if (!body.pending) return store(key, body);
              if (!poll || attempt + 1 >= COVER_POLL_MAX_ATTEMPTS) return null;
              await sleep(coverPollDelayMs(attempt));
            }
          } finally {
            inFlight.delete(flightKey);
          }
        })();
        inFlight.set(flightKey, request);
      }
      const entry = await request;
      return entry ? pick(entry, size) : null;
    },

    forget(params) {
      entries.delete(coverQueryKey(params));
      persist();
    },

    remember(params, cover) {
      store(coverQueryKey(params), cover);
    }
  };
}
