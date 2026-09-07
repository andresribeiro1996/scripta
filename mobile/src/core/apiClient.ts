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

interface TokenStore {
  getRefreshToken(): Promise<string | null>;
  setRefreshToken(token: string): Promise<void>;
  clearRefreshToken(): Promise<void>;
}

interface RawResponse<T> {
  status: number;
  body: T;
  accessTokenUsed: string | null;
}

export function createApiClient(
  baseUrl: string,
  tokenStore: TokenStore,
  getAccessToken: () => string | null,
  setAccessToken: (token: string | null) => void,
  fetcher: typeof fetch = fetch,
) {
  async function rawRequest<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean },
  ): Promise<RawResponse<T>> {
    const headers: Record<string, string> = {};
    const accessTokenUsed = init.auth ? getAccessToken() : null;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (accessTokenUsed) headers.Authorization = `Bearer ${accessTokenUsed}`;
    const res = await fetcher(`${baseUrl}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    return { status: res.status, body: body as T, accessTokenUsed };
  }

  let refreshPromise: Promise<boolean> | null = null;
  let logoutPromise: Promise<void> | null = null;

  function refreshAccessToken(): Promise<boolean> {
    if (logoutPromise) return Promise.resolve(false);
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshToken = await tokenStore.getRefreshToken();
        if (!refreshToken || logoutPromise) return false;
        try {
          const { status, body } = await rawRequest<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
            method: "POST",
            body: { refreshToken },
          });
          if (status !== 200) {
            if (status === 401 || status === 403) await tokenStore.clearRefreshToken();
            setAccessToken(null);
            return false;
          }
          setAccessToken(body.accessToken);
          await tokenStore.setRefreshToken(body.refreshToken);
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

  function logout(): Promise<void> {
    if (!logoutPromise) {
      logoutPromise = (async () => {
        await refreshPromise;
        const refreshToken = await tokenStore.getRefreshToken();
        if (refreshToken) {
          await rawRequest("/auth/logout", { method: "POST", body: { refreshToken } }).catch(() => {});
        }
        await tokenStore.clearRefreshToken();
        setAccessToken(null);
      })().finally(() => {
        logoutPromise = null;
      });
    }
    return logoutPromise;
  }

  const apiClient: ApiClient = {
    async request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
      if (init.auth && !getAccessToken()) throw new ApiError(401, "Not signed in");

      let response = await rawRequest<T & { error?: string }>(path, init);
      if (response.status === 401 && init.auth) {
        const currentToken = getAccessToken();
        const refreshed =
          Boolean(currentToken && currentToken !== response.accessTokenUsed) || (await refreshAccessToken());
        if (refreshed) response = await rawRequest<T & { error?: string }>(path, init);
      }

      if (response.status < 200 || response.status >= 300) {
        throw new ApiError(response.status, response.body.error ?? `Request failed (${response.status})`);
      }
      return response.body as T;
    },
  };

  return { apiClient, refreshAccessToken, logout };
}
