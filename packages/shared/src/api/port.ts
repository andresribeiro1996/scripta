export type ApiAuth = "required" | "optional" | "none";

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth: ApiAuth;
  signal?: AbortSignal;
}

export type ApiRequest = <T>(path: string, init: ApiRequestInit) => Promise<T>;
