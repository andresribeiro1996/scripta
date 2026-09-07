import { API_URL } from "./config";
import { getAccessToken, secureTokenStore, setAccessToken } from "./tokenStore";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ApiClient {
  request<T>(path: string, init?: { method?: string; body?: unknown; auth?: boolean }): Promise<T>;
}

interface RawResponse<T> {
  status: number;
  body: T;
}

async function rawRequest<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean }): Promise<RawResponse<T>> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.auth) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  return { status: res.status, body: body as T };
}

let refreshPromise: Promise<boolean> | null = null;

/** Exchanges the SecureStore-held refresh token for a fresh pair — the one
 *  place either a 401 retry (below) or the cold-start bootstrap
 *  (core/auth.tsx) actually talks to /auth/refresh. Coalesced: mobile
 *  keeps its access token in memory only and refreshes on nearly every
 *  cold start, so a bootstrap refresh can easily race an early screen's
 *  own authenticated query — without this, both would rotate the refresh
 *  token independently, and the second call would present a token the
 *  first already rotated away, which looks exactly like the theft/replay
 *  case the backend's own refresh-rotation grace window exists to soften,
 *  not something worth triggering unnecessarily. Concurrent callers share
 *  one in-flight request and its result instead. */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await secureTokenStore.getRefreshToken();
      if (!refreshToken) return false;
      try {
        const { status, body } = await rawRequest<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
          method: "POST",
          body: { refreshToken },
        });
        if (status !== 200) {
          // Only 401/403 mean the backend actually rejected this refresh
          // token (expired, revoked, theft/replay) — that's the only case
          // where holding onto it is pointless or actively wrong. A 429
          // (rate limited) or 5xx (backend/network trouble) says nothing
          // about the token itself; clearing SecureStore here would sign
          // the user out over a transient failure that a later retry (or
          // the next cold start) could have recovered from.
          if (status === 401 || status === 403) {
            await secureTokenStore.clearRefreshToken();
          }
          setAccessToken(null);
          return false;
        }
        setAccessToken(body.accessToken);
        await secureTokenStore.setRefreshToken(body.refreshToken);
        return true;
      } catch {
        return false;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export const apiClient: ApiClient = {
  async request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
    if (init.auth && !getAccessToken()) {
      throw new ApiError(401, "Not signed in");
    }

    let { status, body } = await rawRequest<T & { error?: string }>(path, init);

    // Exactly one refresh-and-retry per call, same shape as the frontend
    // PWA's apiFetch — a real access-token expiry mid-session (not just
    // the cold-start case core/auth.tsx handles) looks identical from
    // here: a 401 on an otherwise-authenticated request.
    if (status === 401 && init.auth) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        ({ status, body } = await rawRequest<T & { error?: string }>(path, init));
      }
    }

    if (status < 200 || status >= 300) {
      throw new ApiError(status, body.error ?? `Request failed (${status})`);
    }
    return body as T;
  },
};
