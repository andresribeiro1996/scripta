// Per-platform OAuth2 metadata for the four real OAuth providers (not
// Bluesky — see service.ts's connectBluesky for why that one is
// different). Each entry here is everything plugin.ts needs to register
// one @fastify/oauth2 instance plus fetch that platform's own "who did
// we just connect" profile call once the token comes back.
//
// A caveat worth being upfront about: Instagram/Threads/TikTok's OAuth
// products (unlike Google's or X's) are not fully stable, well-worn
// integrations here — nobody has run a live token exchange against them
// in this codebase yet, and their exact endpoints/scopes/param names do
// shift as each platform revises its developer APIs. Treat the values
// below as a correct-as-of-this-writing starting point, not a guarantee:
// once real credentials are in .env, the first real connect attempt for
// each platform is the actual test, and its authorizePath/tokenPath/
// scope/fetchProfile may need a small adjustment against that platform's
// current docs. X (built on @fastify/oauth2's own X_CONFIGURATION
// preset) is the most standard of the four and least likely to need one.

import {
  env,
  instagramOAuthConfigured,
  threadsOAuthConfigured,
  tiktokOAuthConfigured,
  xOAuthConfigured
} from "../../config/env.js";
import type { SocialProvider } from "./domain/types.js";

export interface OAuthProviderConfig {
  provider: Exclude<SocialProvider, "bluesky">;
  displayName: string;
  configured: boolean;
  clientId: string;
  clientSecret: string;
  /** Some providers (TikTok) send this under a different param name than
   *  OAuth2's usual "client_id" — see @fastify/oauth2's
   *  credentials.client.idParamName. */
  clientIdParamName?: string;
  callbackUrl: string;
  scope: string[];
  auth: { authorizeHost: string; authorizePath: string; tokenHost: string; tokenPath: string };
  pkce?: "S256";
  /** Called once with the freshly-obtained access token — resolves the
   *  connected account's own id + human-readable handle, so Settings can
   *  show "Connected as @handle" instead of just a green dot. */
  fetchProfile(accessToken: string): Promise<{ accountId: string; handle: string }>;
}

async function fetchJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Profile lookup failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

export const OAUTH_PROVIDERS: readonly OAuthProviderConfig[] = [
  {
    provider: "x",
    displayName: "X",
    configured: xOAuthConfigured,
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
    callbackUrl: env.X_CALLBACK_URL,
    // X mandates PKCE on its OAuth2 flow (no plain-secret authorization
    // code exchange without it).
    pkce: "S256",
    scope: ["tweet.read", "tweet.write", "users.read", "offline.access"],
    auth: {
      authorizeHost: "https://x.com",
      authorizePath: "/i/oauth2/authorize",
      tokenHost: "https://api.x.com",
      tokenPath: "/2/oauth2/token"
    },
    async fetchProfile(accessToken) {
      const body = await fetchJson("https://api.x.com/2/users/me", accessToken);
      const data = body.data as { id: string; username: string };
      return { accountId: data.id, handle: `@${data.username}` };
    }
  },
  {
    provider: "instagram",
    displayName: "Instagram",
    configured: instagramOAuthConfigured,
    clientId: env.INSTAGRAM_CLIENT_ID,
    clientSecret: env.INSTAGRAM_CLIENT_SECRET,
    callbackUrl: env.INSTAGRAM_CALLBACK_URL,
    // "Instagram API with Instagram Login" — the direct-login product,
    // not the older Facebook-Login-mediated one. Requires a
    // business/creator Instagram account on the developer side.
    scope: ["instagram_business_basic"],
    auth: {
      authorizeHost: "https://www.instagram.com",
      authorizePath: "/oauth/authorize",
      tokenHost: "https://api.instagram.com",
      tokenPath: "/oauth/access_token"
    },
    async fetchProfile(accessToken) {
      const body = await fetchJson(`https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`, accessToken);
      return { accountId: String(body.id), handle: `@${String(body.username)}` };
    }
  },
  {
    provider: "threads",
    displayName: "Threads",
    configured: threadsOAuthConfigured,
    clientId: env.THREADS_CLIENT_ID,
    clientSecret: env.THREADS_CLIENT_SECRET,
    callbackUrl: env.THREADS_CALLBACK_URL,
    // threads_content_publish is required for the two-step create+publish
    // posting flow (see service.ts's postToSocial) — threads_basic alone
    // only covers profile lookup. Accounts connected before this scope
    // was added only carry the old scope on their stored token; their
    // first post attempt will 401, which surfaces via postToSocial's
    // error mapping as a "reconnect Threads in Settings" style message.
    // The existing disconnect/reconnect flow in Settings already fixes
    // that — no extra migration code needed here.
    scope: ["threads_basic", "threads_content_publish"],
    auth: {
      authorizeHost: "https://threads.net",
      authorizePath: "/oauth/authorize",
      tokenHost: "https://graph.threads.net",
      tokenPath: "/oauth/access_token"
    },
    async fetchProfile(accessToken) {
      const body = await fetchJson(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`, accessToken);
      return { accountId: String(body.id), handle: `@${String(body.username)}` };
    }
  },
  {
    provider: "tiktok",
    displayName: "TikTok",
    configured: tiktokOAuthConfigured,
    clientId: env.TIKTOK_CLIENT_KEY,
    clientSecret: env.TIKTOK_CLIENT_SECRET,
    // TikTok's authorize/token endpoints read "client_key", not the
    // OAuth2-conventional "client_id" — see @fastify/oauth2's
    // idParamName escape hatch in plugin.ts.
    clientIdParamName: "client_key",
    callbackUrl: env.TIKTOK_CALLBACK_URL,
    scope: ["user.info.basic"],
    auth: {
      authorizeHost: "https://www.tiktok.com",
      authorizePath: "/v2/auth/authorize/",
      tokenHost: "https://open.tiktokapis.com",
      tokenPath: "/v2/oauth/token/"
    },
    async fetchProfile(accessToken) {
      const body = await fetchJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", accessToken);
      const data = (body.data as { user?: { open_id: string; display_name: string } })?.user;
      if (!data) throw new Error("Unexpected TikTok profile response shape.");
      return { accountId: data.open_id, handle: data.display_name };
    }
  }
];

export function getOAuthProviderConfig(provider: string): OAuthProviderConfig | undefined {
  return OAUTH_PROVIDERS.find((p) => p.provider === provider);
}
