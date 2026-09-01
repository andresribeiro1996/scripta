// Business logic for the socials module. Depends only on the
// SocialsRepository port (not SQLite) and the encryption helpers (not any
// particular platform's SDK) — same separation as every other module's
// service.ts. Nothing here knows about HTTP or Fastify; see routes.ts.

import { decryptSecret, encryptSecret } from "./crypto.js";
import { BlueskyAuthError, SocialsNotConfiguredError } from "./domain/errors.js";
import type { SocialsRepository } from "./domain/ports.js";
import { SOCIAL_PROVIDERS, type SocialProvider, type SocialStatus } from "./domain/types.js";

export interface SaveConnectionInput {
  userId: string;
  provider: SocialProvider;
  accessToken: string;
  refreshToken: string | null;
  /** ISO string, or null if the platform's token doesn't expire / didn't say. */
  expiresAt: string | null;
  accountId: string | null;
  handle: string | null;
}

/** What a caller (routes.ts) gets back after decrypting a connection —
 *  the one place a plaintext token is allowed to exist, and only for as
 *  long as an outbound API call to that platform actually needs it. */
export interface DecryptedConnection {
  provider: SocialProvider;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  handle: string | null;
}

export interface SocialsService {
  listStatuses(userId: string, enabledByProvider: Record<SocialProvider, boolean>): Promise<SocialStatus[]>;
  saveConnection(input: SaveConnectionInput): Promise<void>;
  disconnect(userId: string, provider: SocialProvider): Promise<void>;
  /** Verifies a Bluesky handle + app password against Bluesky's own
   *  createSession endpoint and, on success, stores the resulting
   *  session tokens exactly like an OAuth connection. Throws
   *  BlueskyAuthError on bad credentials, SocialsNotConfiguredError if
   *  the encryption key isn't set. */
  connectBluesky(userId: string, handle: string, appPassword: string): Promise<void>;
  getDecryptedConnection(userId: string, provider: SocialProvider): Promise<DecryptedConnection | null>;
}

export function createSocialsService(repo: SocialsRepository, encryptionKey: string): SocialsService {
  function requireEncryptionKey(): void {
    if (!encryptionKey) throw new SocialsNotConfiguredError();
  }

  return {
    async listStatuses(userId, enabledByProvider) {
      const connections = await repo.listConnections(userId);
      const rows = new Map(connections.map((row) => [row.provider, row] as const));
      return SOCIAL_PROVIDERS.map((provider) => {
        const row = rows.get(provider);
        return {
          provider,
          enabled: enabledByProvider[provider],
          connected: !!row,
          handle: row?.handle ?? null,
          connectedAt: row?.connected_at ?? null
        };
      });
    },

    async saveConnection(input) {
      requireEncryptionKey();
      await repo.upsertConnection({
        userId: input.userId,
        provider: input.provider,
        handle: input.handle,
        providerAccountId: input.accountId,
        accessTokenEnc: encryptSecret(input.accessToken, encryptionKey),
        refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken, encryptionKey) : null,
        expiresAt: input.expiresAt
      });
    },

    async disconnect(userId, provider) {
      await repo.deleteConnection(userId, provider);
    },

    async connectBluesky(userId, handle, appPassword) {
      requireEncryptionKey();

      // Bluesky (AT Protocol) doesn't do redirect-based OAuth here — an
      // "app password" is a scoped, revokable credential the user
      // generates themselves under Settings > App Passwords on Bluesky,
      // meant exactly for third-party apps like this one. createSession
      // exchanges it for a short-lived accessJwt + longer-lived
      // refreshJwt, the same pair every other provider in this module
      // ends up storing.
      const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: handle, password: appPassword })
      });

      if (!res.ok) {
        if (res.status === 401) throw new BlueskyAuthError("That handle/app password combination was rejected by Bluesky.");
        throw new BlueskyAuthError(`Bluesky sign-in failed (${res.status}).`);
      }

      const body = (await res.json()) as { accessJwt: string; refreshJwt: string; did: string; handle: string };

      await repo.upsertConnection({
        userId,
        provider: "bluesky",
        handle: `@${body.handle}`,
        providerAccountId: body.did,
        accessTokenEnc: encryptSecret(body.accessJwt, encryptionKey),
        refreshTokenEnc: encryptSecret(body.refreshJwt, encryptionKey),
        expiresAt: null
      });
    },

    async getDecryptedConnection(userId, provider) {
      const row = await repo.getConnection(userId, provider);
      if (!row) return null;
      return {
        provider,
        accessToken: decryptSecret(row.access_token_enc, encryptionKey),
        refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc, encryptionKey) : null,
        expiresAt: row.expires_at,
        handle: row.handle
      };
    }
  };
}
