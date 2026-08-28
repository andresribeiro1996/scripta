import { apiFetch, ApiError } from "./client";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/** The five platforms Settings' "Socials" section lists — mirrors the
 *  backend's SocialProvider (backend/src/modules/socials/domain/types.ts). */
export type SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky";

export interface SocialStatus {
  provider: SocialProvider;
  /** This server has no client id/secret configured for this platform at
   *  all (see backend .env) — the toggle stays disabled with a tooltip
   *  rather than doing anything on click. */
  enabled: boolean;
  connected: boolean;
  handle: string | null;
  connectedAt: string | null;
}

export async function fetchSocials(): Promise<SocialStatus[]> {
  const body = (await apiFetch("/socials")) as { socials: SocialStatus[] };
  return body.socials;
}

/** X/Instagram/Threads/TikTok only — Bluesky has no redirect flow, see
 *  connectBluesky below. Kicks off a top-level browser navigation to the
 *  backend, which redirects again to the platform's own consent screen;
 *  this call itself just mints the short-lived link session that ties
 *  that whole round trip back to the current user (see the backend's
 *  modules/socials/linkSessions.ts for the full why). Never resolves
 *  normally — the page navigates away. */
export async function startSocialConnect(provider: Exclude<SocialProvider, "bluesky">): Promise<void> {
  const body = (await apiFetch(`/socials/${provider}/link-session`, { method: "POST" })) as { linkId: string };
  window.location.href = `${API_URL}/socials/${provider}/connect?linkId=${encodeURIComponent(body.linkId)}`;
}

/** Bluesky's own app-password sign-in, unlike the other four — see the
 *  backend's connectBluesky for why. Thrown ApiError messages are meant
 *  to be shown directly (e.g. "That handle/app password combination was
 *  rejected by Bluesky."). */
export async function connectBluesky(handle: string, appPassword: string): Promise<SocialStatus[]> {
  const body = (await apiFetch("/socials/bluesky/connect", { method: "POST", body: JSON.stringify({ handle, appPassword }) })) as {
    socials: SocialStatus[];
  };
  return body.socials;
}

export async function disconnectSocial(provider: SocialProvider): Promise<SocialStatus[]> {
  const body = (await apiFetch(`/socials/${provider}`, { method: "DELETE" })) as { socials: SocialStatus[] };
  return body.socials;
}

export { ApiError };
