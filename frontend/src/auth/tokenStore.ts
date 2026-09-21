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

let persistent = false;

function loadFromStorage(): Session | null {
  try {
    const temporary = sessionStorage.getItem(STORAGE_KEY);
    const saved = temporary ?? localStorage.getItem(STORAGE_KEY);
    persistent = !temporary && Boolean(saved);
    if (!saved) return null;
    const value = JSON.parse(saved) as Session;
    return value?.user?.id && typeof value.accessToken === "string" && typeof value.refreshToken === "string" ? value : null;
  } catch {
    return null;
  }
}

let session: Session | null = loadFromStorage();
const listeners = new Set<() => void>();

// vite.config.ts's service worker caches the authed /library response and
// cover/gallery images (Cache Storage, keyed by URL only — it knows nothing
// about which account fetched it). Without this, a second account on the
// same browser is served the previous user's library stale-first.
const ACCOUNT_SCOPED_SW_CACHES = ["api-library", "media-covers"];

function clearAccountScopedCaches(previousUserId: string | null, nextUserId: string | null): void {
  if (typeof caches === "undefined" || previousUserId === nextUserId) return;
  for (const name of ACCOUNT_SCOPED_SW_CACHES) void caches.delete(name);
}

export function getSession(): Session | null {
  return session;
}

export function setSession(next: Session | null, remember = persistent): void {
  clearAccountScopedCaches(session?.user.id ?? null, next?.user.id ?? null);
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  if (next) (remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, JSON.stringify(next));
  persistent = remember;
  session = next;
  listeners.forEach((listener) => listener());
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
