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
export const COVER_POLL_INTERVAL_MS = 3_000;
export const COVER_POLL_GIVE_UP_MS = 30 * 60 * 1000;
export const COVER_BATCH_SIZE = 100;
export const COVER_POLL_MAX_FAILED_TICKS = 3;

export function coverQueryKey(params: CoverLookupParams): string {
  const query = new URLSearchParams();
  if (params.isbn) query.set("isbn", params.isbn);
  if (params.title) query.set("title", params.title);
  if (params.author) query.set("author", params.author);
  return query.toString();
}

export interface CoverResolverDeps {
  fetchResolve(query: string): Promise<ResolvedCoverResponse>;
  fetchResolveBatch(lookups: CoverLookupParams[]): Promise<ResolvedCoverResponse[]>;
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

interface PendingCover {
  lookup: CoverLookupParams;
  since: number;
  resolve(entry: CoverCacheEntry | null): void;
  reject(error: unknown): void;
}

export function createCoverResolver(deps: CoverResolverDeps): CoverResolver {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const entries = new Map<string, CoverCacheEntry>();
  const inFlight = new Map<string, Promise<CoverCacheEntry | null>>();
  const pending = new Map<string, PendingCover>();
  let polling = false;
  let failedTicks = 0;

  const fresh = (entry: CoverCacheEntry | undefined) => (entry && now() - entry.at < COVER_CACHE_TTL_MS ? entry : undefined);
  const pick = (entry: CoverCacheEntry, size: CoverSize) => (size === "full" ? entry.fullUrl ?? entry.url : entry.url);

  function persist() {
    deps.persist(Object.fromEntries([...entries].filter(([, entry]) => entry.url !== null)));
  }

  function put(key: string, cover: { url: string | null; fullUrl: string | null }): CoverCacheEntry {
    const entry = { url: cover.url, fullUrl: cover.fullUrl, at: now() };
    entries.set(key, entry);
    return entry;
  }

  function store(key: string, cover: { url: string | null; fullUrl: string | null }): CoverCacheEntry {
    const entry = put(key, cover);
    persist();
    return entry;
  }

  async function pollOnce() {
    const keys = [...pending.keys()];
    let succeeded = false;
    let failure: { error: unknown } | null = null;
    for (let start = 0; start < keys.length; start += COVER_BATCH_SIZE) {
      const chunk = keys.slice(start, start + COVER_BATCH_SIZE);
      try {
        const bodies = await deps.fetchResolveBatch(chunk.map((key) => pending.get(key)!.lookup));
        succeeded = true;
        let settled = false;
        chunk.forEach((key, index) => {
          const body = bodies[index];
          if (!body || body.pending) return;
          const waiter = pending.get(key)!;
          pending.delete(key);
          waiter.resolve(put(key, body));
          settled = true;
        });
        if (settled) persist();
      } catch (error) {
        failure = { error };
      }
    }
    if (succeeded || !failure) failedTicks = 0;
    else if (++failedTicks >= COVER_POLL_MAX_FAILED_TICKS) {
      for (const waiter of pending.values()) waiter.reject(failure.error);
      pending.clear();
    }
    for (const [key, waiter] of pending) {
      if (now() - waiter.since < COVER_POLL_GIVE_UP_MS) continue;
      pending.delete(key);
      waiter.resolve(null);
    }
  }

  async function pollWhilePending() {
    try {
      while (pending.size > 0) {
        await sleep(COVER_POLL_INTERVAL_MS);
        await pollOnce();
      }
    } finally {
      polling = false;
      failedTicks = 0;
    }
  }

  function waitForCover(key: string): Promise<CoverCacheEntry | null> {
    return new Promise((resolve, reject) => {
      pending.set(key, { lookup: Object.fromEntries(new URLSearchParams(key)), since: now(), resolve, reject });
      if (polling) return;
      polling = true;
      void pollWhilePending();
    });
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
            const body = await deps.fetchResolve(key);
            if (!body.pending) return store(key, body);
            return poll ? await waitForCover(key) : null;
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
