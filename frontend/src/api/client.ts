// Shared HTTP helpers. apiFetch is what every authenticated call (library,
// and anything added later) should go through: it attaches the current
// access token, and — the one bit of real logic here — on a 401 tries
// exactly one refresh-and-retry before giving up. Concurrent 401s share a
// single in-flight refresh instead of each firing their own.

import { getSession, setSession } from "../auth/tokenStore";
import { getLocale, t } from "../i18n";
import { API_URL } from "./baseUrl";

export class ApiError extends Error {
  status: number;
  readonly field?: string;
  constructor(status: number, message: string, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
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
  headers.set("Accept-Language", getLocale());
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

const WAIT_KEYS = { second: "errors.waitSeconds", minute: "errors.waitMinutes", hour: "errors.waitHours" } as const;

function waitText(body: unknown): string {
  const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "";
  const match = /(\d+) (second|minute|hour)s?/.exec(message);
  if (!match) return t("errors.waitFallback");
  return t(WAIT_KEYS[match[2] as keyof typeof WAIT_KEYS], { count: Number(match[1]) });
}

async function parseOrThrow(res: Response): Promise<unknown> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // no body (e.g. a 204), that's fine
  }
  if (res.status === 429) {
    throw new ApiError(429, t("errors.tooManyTries", { wait: waitText(body) }));
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : getLocale() === "en" ? res.statusText : t("errors.requestFailed", { status: res.status });
    throw new ApiError(res.status, message, body && typeof body === "object" && "field" in body && typeof body.field === "string" ? body.field : undefined);
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
        if (getSession()?.refreshToken !== current.refreshToken) return false;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) setSession(null);
          return false;
        }
        const body = (await res.json()) as { accessToken: string; refreshToken: string };
        if (getSession()?.refreshToken !== current.refreshToken) return false;
        setSession({ user: current.user, accessToken: body.accessToken, refreshToken: body.refreshToken });
        return true;
      } catch {
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
