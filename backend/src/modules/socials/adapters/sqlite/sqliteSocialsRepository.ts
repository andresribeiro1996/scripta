// The SQLite implementation of the SocialsRepository port. Only file in
// this module that knows SQL — service.ts only ever sees the
// SocialsRepository interface this fulfills.

import type { DatabaseSync } from "node:sqlite";
import type { SocialsRepository, UpsertConnectionInput } from "../../domain/ports.js";
import type { SocialConnectionRow } from "../../domain/types.js";

export function createSqliteSocialsRepository(db: DatabaseSync): SocialsRepository {
  const listStmt = db.prepare(`SELECT * FROM social_connections WHERE user_id = ?`);
  const getStmt = db.prepare(`SELECT * FROM social_connections WHERE user_id = ? AND provider = ?`);
  const upsertStmt = db.prepare(`
    INSERT INTO social_connections
      (user_id, provider, handle, provider_account_id, access_token_enc, refresh_token_enc, expires_at, connected_at)
    VALUES
      ($user_id, $provider, $handle, $provider_account_id, $access_token_enc, $refresh_token_enc, $expires_at, $connected_at)
    ON CONFLICT(user_id, provider) DO UPDATE SET
      handle = excluded.handle,
      provider_account_id = excluded.provider_account_id,
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      expires_at = excluded.expires_at,
      connected_at = excluded.connected_at
  `);
  const deleteStmt = db.prepare(`DELETE FROM social_connections WHERE user_id = ? AND provider = ?`);

  return {
    async listConnections(userId) {
      return listStmt.all(userId) as unknown as SocialConnectionRow[];
    },

    async getConnection(userId, provider) {
      return getStmt.get(userId, provider) as SocialConnectionRow | undefined;
    },

    async upsertConnection(input: UpsertConnectionInput) {
      const connectedAt = new Date().toISOString();
      upsertStmt.run({
        $user_id: input.userId,
        $provider: input.provider,
        $handle: input.handle,
        $provider_account_id: input.providerAccountId,
        $access_token_enc: input.accessTokenEnc,
        $refresh_token_enc: input.refreshTokenEnc,
        $expires_at: input.expiresAt,
        $connected_at: connectedAt
      });
      return {
        user_id: input.userId,
        provider: input.provider,
        handle: input.handle,
        provider_account_id: input.providerAccountId,
        access_token_enc: input.accessTokenEnc,
        refresh_token_enc: input.refreshTokenEnc,
        expires_at: input.expiresAt,
        connected_at: connectedAt
      };
    },

    async deleteConnection(userId, provider) {
      deleteStmt.run(userId, provider);
    }
  } satisfies SocialsRepository;
}
