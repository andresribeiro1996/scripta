// Domain types for the socials module.

/** The five platforms this module knows about. Four are real OAuth2
 *  connections (see providerConfig.ts); "bluesky" is the odd one out —
 *  AT Protocol's full OAuth is per-PDS and DPoP-bound, heavy for what a
 *  personal project needs, so Bluesky is connected with a handle + app
 *  password instead (see service.ts's connectBluesky). Both shapes end
 *  up stored the same way (an encrypted token row), so everything above
 *  storage — the settings list, enable/disable, the disconnect warning —
 *  treats all five identically. */
export type SocialProvider = "x" | "instagram" | "threads" | "tiktok" | "bluesky";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = ["x", "instagram", "threads", "tiktok", "bluesky"];

/** Row shape as stored — the two token columns are ciphertext (see
 *  ../crypto.ts), never plaintext past the moment they're first written.
 *  One row per (user, provider): connecting again just replaces it. */
export interface SocialConnectionRow {
  user_id: string;
  provider: SocialProvider;
  handle: string | null;
  provider_account_id: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  connected_at: string;
}

/** What GET /socials hands back — one entry per provider, always, even
 *  ones this server has no credentials for at all (enabled: false) or
 *  the user has never connected (connected: false). Never carries a
 *  token in either direction; the frontend has no business seeing one. */
export interface SocialStatus {
  provider: SocialProvider;
  /** This server has what it needs to attempt a connection at all — env
   *  vars set for an OAuth platform, or the encryption key for Bluesky.
   *  A settings toggle for a provider with enabled: false stays disabled
   *  with an explanatory tooltip rather than doing anything on click. */
  enabled: boolean;
  connected: boolean;
  handle: string | null;
  connectedAt: string | null;
}
