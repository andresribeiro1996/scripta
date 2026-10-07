// Domain types for the socials module.

import type { SocialProvider } from "@scripta/shared";

export type { SocialProvider, SocialStatus } from "@scripta/shared";

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
