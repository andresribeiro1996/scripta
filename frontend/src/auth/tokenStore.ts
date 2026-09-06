// The session lives outside React (plain module state + localStorage), so
// that api/client.ts — which isn't a component and can't use hooks — can
// read the current access token and write a refreshed one back, without
// needing the whole React tree threaded through it. AuthContext.tsx wraps
// this with useSyncExternalStore purely so components re-render when it
// changes; this file is the actual source of truth.

export interface Session {
  // `username` is null for a Google-signed-in account that hasn't chosen
  // one yet — App.tsx routes a session in that state to /choose-username
  // before letting it any further in. `avatarId` is null until a profile
  // picture is uploaded (the avatar step is skippable).
  user: { id: string; email: string; username: string | null; avatarId: string | null };
  accessToken: string;
  refreshToken: string;
}

const STORAGE_KEY = "kobo_session";

function loadFromStorage(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

let session: Session | null = loadFromStorage();
const listeners = new Set<() => void>();

export function getSession(): Session | null {
  return session;
}

export function setSession(next: Session | null): void {
  session = next;
  if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  else localStorage.removeItem(STORAGE_KEY);
  listeners.forEach((listener) => listener());
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
