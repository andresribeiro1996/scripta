import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { File } from "expo-file-system";
import { GoogleSignInCancelledError, startGoogleSignIn } from "../features/auth/googleSignIn";
import { apiClient, logout, refreshAccessToken, setSessionExpiredHandler } from "./api";
import { seedDevSession } from "./devSession";
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
  /** True when there IS a stored session but the server couldn't be reached
   *  to load it. Distinct from `user === null`, which means signed out —
   *  conflating the two showed a login form to someone who was simply
   *  offline, and left them there for the rest of the app's life. */
  unreachable: boolean;
  /** Re-attempts the startup session load. Safe to call repeatedly. */
  retry(): Promise<void>;
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
  const [unreachable, setUnreachable] = useState(false);

  /** Whether a failed load means "signed out" or merely "couldn't reach the
   *  server" is decided by what survives in the store: refreshAccessToken
   *  clears the refresh token on 401/403 and deliberately leaves it alone on
   *  a network error. So a token still present after a failure is a session
   *  we simply could not load yet. */
  const loadSession = useCallback(async () => {
    try {
      // Dev-only, and a no-op unless both conditions below hold: see
      // devSession.ts's own comment for why this can't reach a release
      // build. Lets scripts/dev-emulator.mjs boot straight into a
      // signed-in session on a fresh emulator install, no password.
      await seedDevSession(secureTokenStore, {
        isDev: __DEV__,
        devToken: process.env.EXPO_PUBLIC_DEV_REFRESH_TOKEN,
      });
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
        setUser(me.user);
        setUnreachable(false);
        return;
      }
      setUnreachable(Boolean(await secureTokenStore.getRefreshToken()));
    } catch {
      setUnreachable(Boolean(await secureTokenStore.getRefreshToken()));
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    const clearSessionExpiredHandler = setSessionExpiredHandler(() => {
      setUser(null);
      // A 401 IS a real sign-out, so stop calling it unreachable.
      setUnreachable(false);
    });
    void loadSession();
    return clearSessionExpiredHandler;
  }, [loadSession]);

  // Coming back to the foreground is the moment connectivity most often
  // returns — someone reopening the app after moving between networks. Only
  // retries when there is a session waiting to be loaded, so a signed-out app
  // does not poll the server every time it is opened.
  useEffect(() => {
    if (!unreachable) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadSession();
    });
    return () => subscription.remove();
  }, [loadSession, unreachable]);

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
    setUnreachable(false);
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
    form.append("image", new File(file.uri));
    const res = await apiClient.request<{ user: AuthUser }>("/auth/avatar", { method: "POST", body: form, auth: true });
    setUser(res.user);
  }, []);

  const removeAvatar = useCallback(async () => {
    const res = await apiClient.request<{ user: AuthUser }>("/auth/avatar", { method: "DELETE", auth: true });
    setUser(res.user);
  }, []);

  const value = useMemo(
    () => ({ ready, user, unreachable, retry: loadSession, signUp, signIn, signInWithGoogle, signOut, setUsername, uploadAvatar, removeAvatar }),
    [ready, user, unreachable, loadSession, signUp, signIn, signInWithGoogle, signOut, setUsername, uploadAvatar, removeAvatar],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export { getAccessToken };
