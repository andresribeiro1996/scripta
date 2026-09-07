import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient } from "./api";
import { getAccessToken, secureTokenStore, setAccessToken } from "./tokenStore";

interface AuthUser {
  id: string;
  email: string;
  username: string | null;
}

interface AuthState {
  ready: boolean;
  user: AuthUser | null;
  signIn(identifier: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const refreshToken = await secureTokenStore.getRefreshToken();
        if (refreshToken) {
          const refreshed = await apiClient.request<LoginResponse>("/auth/refresh", {
            method: "POST",
            body: { refreshToken },
          });
          if (!cancelled) {
            setAccessToken(refreshed.accessToken);
            setUser(refreshed.user);
            await secureTokenStore.setRefreshToken(refreshed.refreshToken);
          }
        }
      } catch {
        await secureTokenStore.clearRefreshToken().catch(() => {});
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const res = await apiClient.request<LoginResponse>("/auth/login", {
      method: "POST",
      body: { identifier, password },
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await secureTokenStore.setRefreshToken(res.refreshToken);
  }, []);

  const signOut = useCallback(async () => {
    const refreshToken = await secureTokenStore.getRefreshToken();
    if (refreshToken) {
      await apiClient.request("/auth/logout", { method: "POST", body: { refreshToken } }).catch(() => {});
    }
    await secureTokenStore.clearRefreshToken();
    setAccessToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ ready, user, signIn, signOut }), [ready, user, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { getAccessToken };
