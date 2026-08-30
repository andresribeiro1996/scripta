// Business logic for the socials module. Depends only on the
// SocialsRepository port (not SQLite) and the encryption helpers (not any
// particular platform's SDK) — same separation as every other module's
// service.ts. Nothing here knows about HTTP or Fastify; see routes.ts.

import { decryptSecret, encryptSecret } from "./crypto.js";
import { BlueskyAuthError, SocialNotConnectedError, SocialPostRejectedError, SocialsNotConfiguredError } from "./domain/errors.js";
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
  /** The platform's own id for the connected account — e.g. Threads'
   *  numeric user id, needed as a path segment for its posting
   *  endpoints. Null for providers/rows where the OAuth callback never
   *  recorded one. */
  accountId: string | null;
  handle: string | null;
}

export interface SocialsService {
  listStatuses(userId: string, enabledByProvider: Record<SocialProvider, boolean>): SocialStatus[];
  saveConnection(input: SaveConnectionInput): void;
  disconnect(userId: string, provider: SocialProvider): void;
  /** Verifies a Bluesky handle + app password against Bluesky's own
   *  createSession endpoint and, on success, stores the resulting
   *  session tokens exactly like an OAuth connection. Throws
   *  BlueskyAuthError on bad credentials, SocialsNotConfiguredError if
   *  the encryption key isn't set. */
  connectBluesky(userId: string, handle: string, appPassword: string): Promise<void>;
  getDecryptedConnection(userId: string, provider: SocialProvider): DecryptedConnection | null;
  /** Posts `text` on the user's behalf to a platform this module can
   *  actually publish to today (X, Threads — see the per-platform notes
   *  on postToSocial's implementation for why the others aren't here
   *  yet). Throws SocialNotConnectedError if the user hasn't connected
   *  that platform, SocialPostRejectedError if the platform's API itself
   *  rejected the post (bad/expired token, malformed request, or any
   *  other non-ok response) — never throws a raw fetch/network error out
   *  to the caller uncategorized. */
  postToSocial(userId: string, provider: SocialProvider, input: { text: string }): Promise<{ postUrl?: string }>;
}

export function createSocialsService(repo: SocialsRepository, encryptionKey: string): SocialsService {
  function requireEncryptionKey(): void {
    if (!encryptionKey) throw new SocialsNotConfiguredError();
  }

  function getDecryptedConnection(userId: string, provider: SocialProvider): DecryptedConnection | null {
    const row = repo.getConnection(userId, provider);
    if (!row) return null;
    return {
      provider,
      accessToken: decryptSecret(row.access_token_enc, encryptionKey),
      refreshToken: row.refresh_token_enc ? decryptSecret(row.refresh_token_enc, encryptionKey) : null,
      expiresAt: row.expires_at,
      accountId: row.provider_account_id,
      handle: row.handle
    };
  }

  return {
    listStatuses(userId, enabledByProvider) {
      const rows = new Map(repo.listConnections(userId).map((row) => [row.provider, row]));
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

    saveConnection(input) {
      requireEncryptionKey();
      repo.upsertConnection({
        userId: input.userId,
        provider: input.provider,
        handle: input.handle,
        providerAccountId: input.accountId,
        accessTokenEnc: encryptSecret(input.accessToken, encryptionKey),
        refreshTokenEnc: input.refreshToken ? encryptSecret(input.refreshToken, encryptionKey) : null,
        expiresAt: input.expiresAt
      });
    },

    disconnect(userId, provider) {
      repo.deleteConnection(userId, provider);
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

      repo.upsertConnection({
        userId,
        provider: "bluesky",
        handle: `@${body.handle}`,
        providerAccountId: body.did,
        accessTokenEnc: encryptSecret(body.accessJwt, encryptionKey),
        refreshTokenEnc: encryptSecret(body.refreshJwt, encryptionKey),
        expiresAt: null
      });
    },

    getDecryptedConnection,

    async postToSocial(userId, provider, input) {
      if (provider !== "x" && provider !== "threads") {
        throw new SocialsNotConfiguredError(`Posting isn't supported for "${provider}" yet.`);
      }

      const conn = getDecryptedConnection(userId, provider);
      if (!conn) throw new SocialNotConnectedError(provider);

      if (provider === "x") {
        const res = await fetch("https://api.x.com/2/tweets", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${conn.accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ text: input.text })
        });

        if (!res.ok) {
          if (res.status === 401 || res.status === 403) throw new SocialPostRejectedError("X");
          throw new SocialPostRejectedError("X", `HTTP ${res.status}`);
        }

        const body = (await res.json()) as { data: { id: string } };
        return { postUrl: `https://x.com/i/web/status/${body.data.id}` };
      }

      // provider === "threads" — a two-step Graph API flow: create a
      // (unpublished) media container, then publish it. Threads has no
      // single "post this text" endpoint like X's.
      if (!conn.accountId) {
        throw new SocialPostRejectedError("Threads", "missing linked account id");
      }

      const createRes = await fetch(`https://graph.threads.net/v1.0/${conn.accountId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ media_type: "TEXT", text: input.text, access_token: conn.accessToken })
      });

      if (!createRes.ok) {
        if (createRes.status === 401) throw new SocialPostRejectedError("Threads");
        throw new SocialPostRejectedError("Threads", `create step: HTTP ${createRes.status}`);
      }

      const { id: creationId } = (await createRes.json()) as { id: string };

      const publishRes = await fetch(`https://graph.threads.net/v1.0/${conn.accountId}/threads_publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creation_id: creationId, access_token: conn.accessToken })
      });

      if (!publishRes.ok) {
        if (publishRes.status === 401) throw new SocialPostRejectedError("Threads");
        throw new SocialPostRejectedError("Threads", `publish step: HTTP ${publishRes.status}`);
      }

      // Threads' publish response carries no browsable permalink.
      return {};
    }
  };
}
