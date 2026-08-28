// The port: everything the socials domain (service.ts) needs from
// persistence. Same shape of contract as modules/library/domain/ports.ts.

import type { SocialConnectionRow, SocialProvider } from "./types.js";

export interface UpsertConnectionInput {
  userId: string;
  provider: SocialProvider;
  handle: string | null;
  providerAccountId: string | null;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: string | null;
}

export interface SocialsRepository {
  listConnections(userId: string): SocialConnectionRow[];
  getConnection(userId: string, provider: SocialProvider): SocialConnectionRow | undefined;
  /** Insert-or-replace: one row per (user, provider). */
  upsertConnection(input: UpsertConnectionInput): SocialConnectionRow;
  deleteConnection(userId: string, provider: SocialProvider): void;
}
