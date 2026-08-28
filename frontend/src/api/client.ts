// Shared HTTP helpers. apiFetch is what every authenticated call (library,
// and anything added later) should go through: it attaches the current
// access token, and — the one bit of real logic here — on a 401 tries
// exactly one refresh-and-retry before giving up. Concurrent 401s share a
// single in-flight refresh instead of each firing their own.

import { getSession, setSession } from "../auth/tokenStore";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function rawFetch(path: string, init: RequestInit | undefined, accessToken: string | undefined): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  // Never for FormData (gallery uploads, api/gallery.ts): the browser has
  // to set its own multipart/form-data boundary, which it only does when
  // Content-Type is left unset entirely — setting "application/json" here
  // would silently break every upload.
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function parseOrThrow(res: Response): Promise<unknown> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no body (e.g. a 204), that's fine
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : res.statusText;
    throw new ApiError(res.status, message);
  }
  return body;
}

let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  const current = getSession();
  if (!current) return Promise.resolve(false);

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await rawFetch("/auth/refresh", { method: "POST", body: JSON.stringify({ refreshToken: current.refreshToken }) }, undefined);
        if (!res.ok) {
          setSession(null);
          return false;
        }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        setSession({ user: current.user, accessToken: body.accessToken, refreshToken: body.refreshToken });
        return true;
      } catch {
        setSession(null);
        return false;
      } finally {
        refreshPromise = null;
      }
    })();
  }
  return refreshPromise;
}

/** For requests that need a signed-in user. */
export async function apiFetch(path: string, init?: RequestInit): Promise<unknown> {
  const session = getSession();
  let res = await rawFetch(path, init, session?.accessToken);

  if (res.status === 401 && session) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await rawFetch(path, init, getSession()?.accessToken);
    }
  }

  return parseOrThrow(res);
}

/** For requests with no session yet — signup/login. */
export async function publicFetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await rawFetch(path, init, undefined);
  return parseOrThrow(res);
}
