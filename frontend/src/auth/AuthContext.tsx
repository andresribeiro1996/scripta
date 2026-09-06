import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { apiFetch, publicFetch } from "../api/client";
import { getSession, setSession, subscribeToSession, type Session } from "./tokenStore";

interface AuthTokenResponse {
  user: Session["user"];
  accessToken: string;
  refreshToken: string;
}

interface AuthContextValue {
  session: Session | null;
  signup: (email: string, username: string, password: string) => Promise<void>;
  /** `identifier` may be either the account's email or its username. */
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Claims a username for the current session — the step a Google
   *  sign-in without one yet goes through on its first login. */
  setUsername: (username: string) => Promise<void>;
  /** Uploads (validates/crops server-side) a profile picture, replacing
   *  any previous one. Multipart, not JSON — same FormData carve-out in
   *  api/client.ts as gallery uploads. */
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore is the correct hook for exactly this shape: state
  // that lives outside React (tokenStore.ts) but needs to trigger
  // re-renders here when it changes.
  const session = useSyncExternalStore(subscribeToSession, getSession);

  async function signup(email: string, username: string, password: string) {
    const body = (await publicFetch("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, username, password })
    })) as AuthTokenResponse;
    setSession({ user: body.user, accessToken: body.accessToken, refreshToken: body.refreshToken });
  }

  async function login(identifier: string, password: string) {
    const body = (await publicFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password })
    })) as AuthTokenResponse;
    setSession({ user: body.user, accessToken: body.accessToken, refreshToken: body.refreshToken });
  }

  async function logout() {
    const current = getSession();
    if (current) {
      // Best-effort: clear the local session regardless of whether the
      // server call succeeds (e.g. the network is down) — the user asked
      // to log out, so the app should honor that locally either way.
      try {
        await publicFetch("/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: current.refreshToken }) });
      } catch {
        /* ignore */
      }
    }
    setSession(null);
  }

  async function setUsername(username: string) {
    const current = getSession();
    if (!current) throw new Error("Not signed in.");
    const body = (await apiFetch("/auth/username", {
      method: "POST",
      body: JSON.stringify({ username })
    })) as { user: Session["user"] };
    setSession({ ...current, user: body.user });
  }

  async function uploadAvatar(file: File) {
    const current = getSession();
    if (!current) throw new Error("Not signed in.");
    const form = new FormData();
    form.append("image", file, file.name);
    const body = (await apiFetch("/auth/avatar", { method: "POST", body: form })) as { user: Session["user"] };
    setSession({ ...current, user: body.user });
  }

  async function removeAvatar() {
    const current = getSession();
    if (!current) throw new Error("Not signed in.");
    const body = (await apiFetch("/auth/avatar", { method: "DELETE" })) as { user: Session["user"] };
    setSession({ ...current, user: body.user });
  }

  return (
    <AuthContext.Provider value={{ session, signup, login, logout, setUsername, uploadAvatar, removeAvatar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
