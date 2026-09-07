// A tiny multipart POST/DELETE helper for this feature's own gallery
// client (see gallery.ts) — apiClient.request (core/api.ts) only ever
// sends JSON bodies, so a raw file upload has to bypass it, same as
// features/import/api.ts's uploadImportPreview already does. Unlike that
// call, this one DOES retry once through the shared refreshAccessToken()
// coalescer on a 401 — cover assignment is reachable from deep inside a
// long browsing session, where an access token is far more likely to
// have gone stale than right after sign-in.

import { ApiError, refreshAccessToken } from "../../../core/api";
import { API_URL } from "../../../core/config";
import { getAccessToken } from "../../../core/tokenStore";

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function errorMessageFrom(body: unknown, status: number): string {
  return typeof body === "object" && body !== null && "error" in body ? String((body as { error: unknown }).error) : `Request failed (${status})`;
}

export async function authorizedFetch<T>(path: string, init: { method?: string; body?: FormData } = {}): Promise<T> {
  async function attempt(): Promise<Response> {
    const token = getAccessToken();
    if (!token) throw new ApiError(401, "Not signed in");
    return fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${token}` },
      body: init.body,
    });
  }

  let response = await attempt();
  if (response.status === 401 && (await refreshAccessToken())) {
    response = await attempt();
  }
  const body = await parseBody(response);
  if (!response.ok) throw new ApiError(response.status, errorMessageFrom(body, response.status));
  return body as T;
}
