import { API_URL } from "./config";
import { getAccessToken, secureTokenStore, setAccessToken } from "./tokenStore";
import { ApiError, createApiClient, type ApiClient } from "./apiClient";

const session = createApiClient(API_URL, secureTokenStore, getAccessToken, setAccessToken);

export const apiClient: ApiClient = session.apiClient;
export const refreshAccessToken = session.refreshAccessToken;
export const recoverAccessToken = session.recoverAccessToken;
export const logout = session.logout;
export const setSessionExpiredHandler = session.setSessionExpiredHandler;
export { ApiError };
export type { ApiClient };
