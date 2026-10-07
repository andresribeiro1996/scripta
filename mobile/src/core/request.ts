import type { ApiRequest, ApiRequestInit } from "@scripta/shared";
import type { ApiClient } from "./apiClient";

export function createRequest(apiClient: ApiClient, getAccessToken: () => string | null): ApiRequest {
  return function request<T>(path: string, { auth, ...init }: ApiRequestInit): Promise<T> {
    return apiClient.request<T>(path, { ...init, auth: auth === "required" || (auth === "optional" && getAccessToken() !== null) });
  };
}
