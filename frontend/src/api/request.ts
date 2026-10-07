import type { ApiRequest, ApiRequestInit } from "@scripta/shared";
import { apiFetch, publicFetch } from "./client";

async function send<T>(path: string, { method, body, auth, signal }: ApiRequestInit): Promise<T> {
  const payload = body === undefined || body instanceof FormData ? body : JSON.stringify(body);
  return (await (auth === "none" ? publicFetch : apiFetch)(path, { method, signal, body: payload })) as T;
}

export const request: ApiRequest = send;
