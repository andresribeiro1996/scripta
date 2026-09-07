import { API_URL } from "./config";
import { getAccessToken } from "./tokenStore";

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

export const apiClient: ApiClient = {
  async request<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.auth) {
      const token = getAccessToken();
      if (!token) throw new ApiError(401, "Not signed in");
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new ApiError(res.status, (body as { error?: string }).error ?? `Request failed (${res.status})`);
    }
    return body as T;
  },
};
