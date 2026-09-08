import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { GoogleSignInCancelledError, startGoogleSignIn } from "../features/auth/googleSignIn";
import { apiClient, logout, refreshAccessToken, setSessionExpiredHandler } from "./api";
import { getAccessToken, secureTokenStore, setAccessToken } from "./tokenStore";

interface AuthUser {
  id: string;
  email: string;
  // null for a Google sign-in that hasn't claimed one yet — see
  // (app)/_layout.tsx's onboarding guard, which routes a session in this
  // state to /choose-username before letting it any further in (the same
  // gate backend/README documents for the PWA's own RequireUsername).
  username: string | null;
  avatarId: string | null;
}

interface AuthState {
  ready: boolean;
  user: AuthUser | null;
  signUp(email: string, username: string, password: string): Promise<void>;
  signIn(identifier: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** Claims a username for the current session — the step a Google
   *  sign-in without one yet goes through before the app treats it as
   *  fully set up. */
  setUsername(username: string): Promise<void>;
  uploadAvatar(file: { uri: string; name: string; mimeType: string }): Promise<void>;
  removeAvatar(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

interface AuthTokenResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

export { GoogleSignInCancelledError };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    const clearSessionExpiredHandler = setSessionExpiredHandler(() => setUser(null));
    (async () => {
      try {
        // Shared with api.ts's own 401 retry — see refreshAccessToken's
        // own comment for why this must be the SAME coalesced call rather
        // than a second, independent refresh done inline here.
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          // /auth/refresh returns tokens only — the user has to come from
          // a separate /auth/me call (found during Task 2's own on-device
          // testing: a killed-and-reopened app has no in-memory user to
          // fall back on).
          const me = await apiClient.request<{ user: AuthUser }>("/auth/me", { auth: true });
          if (!cancelled) setUser(me.user);
        }
      } catch {
        // refreshAccessToken already clears SecureStore/the access token
        // on a real failure — nothing else to clean up here.
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      clearSessionExpiredHandler();
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const res = await apiClient.request<AuthTokenResponse>("/auth/login", {
      method: "POST",
      body: { identifier, password },
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await secureTokenStore.setRefreshToken(res.refreshToken);
  }, []);

  const signUp = useCallback(async (email: string, username: string, password: string) => {
    const res = await apiClient.request<AuthTokenResponse>("/auth/signup", {
      method: "POST",
      body: { email, username, password },
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await secureTokenStore.setRefreshToken(res.refreshToken);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { code, codeVerifier } = await startGoogleSignIn();
    const res = await apiClient.request<AuthTokenResponse>("/auth/google/exchange", {
      method: "POST",
      body: { code, codeVerifier },
    });
    setAccessToken(res.accessToken);
    setUser(res.user);
    await secureTokenStore.setRefreshToken(res.refreshToken);
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const setUsername = useCallback(async (username: string) => {
    const res = await apiClient.request<{ user: AuthUser }>("/auth/username", {
      method: "POST",
      body: { username },
      auth: true,
    });
    setUser(res.user);
  }, []);

  const uploadAvatar = useCallback(async (file: { uri: string; name: string; mimeType: string }) => {
    const form = new FormData();
    form.append("image", { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
    const res = await apiClient.request<{ user: AuthUser }>("/auth/avatar", { method: "POST", body: form, auth: true });
    setUser(res.user);
  }, []);

  const removeAvatar = useCallback(async () => {
    const res = await apiClient.request<{ user: AuthUser }>("/auth/avatar", { method: "DELETE", auth: true });
    setUser(res.user);
  }, []);

  const value = useMemo(
    () => ({ ready, user, signUp, signIn, signInWithGoogle, signOut, setUsername, uploadAvatar, removeAvatar }),
    [ready, user, signUp, signIn, signInWithGoogle, signOut, setUsername, uploadAvatar, removeAvatar],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { getAccessToken };
