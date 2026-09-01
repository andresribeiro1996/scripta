// The Postgres implementation of the SocialsRepository port. A sibling of
// adapters/sqlite/, not a replacement — service.ts is untouched.
//
// Every token column here is ciphertext (see ../../crypto.ts). This
// adapter never sees a plaintext token and never should.

import type { Pool } from "pg";
import type { SocialsRepository } from "../../domain/ports.js";
import type { SocialConnectionRow, SocialProvider } from "../../domain/types.js";

function toRow(raw: Record<string, unknown> | undefined): SocialConnectionRow | undefined {
  if (!raw) return undefined;
  return {
    ...raw,
    connected_at: raw.connected_at instanceof Date ? raw.connected_at.toISOString() : raw.connected_at
  } as SocialConnectionRow;
}

export function createPgSocialsRepository(pool: Pool): SocialsRepository {
  return {
    async listConnections(userId) {
      const { rows } = await pool.query(`SELECT * FROM social_connections WHERE user_id = $1 ORDER BY provider`, [userId]);
      return rows.map((row) => toRow(row)!);
    },

    async getConnection(userId, provider) {
      const { rows } = await pool.query(`SELECT * FROM social_connections WHERE user_id = $1 AND provider = $2`, [
        userId,
        provider
      ]);
      return toRow(rows[0]);
    },

    async upsertConnection(input) {
      // One row per (user, provider) — reconnecting replaces the tokens
      // rather than accumulating rows. RETURNING so connected_at is the
      // value actually stored rather than one reconstructed in JS.
      const { rows } = await pool.query(
        `INSERT INTO social_connections
           (user_id, provider, handle, provider_account_id, access_token_enc, refresh_token_enc, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, provider) DO UPDATE SET
           handle = EXCLUDED.handle,
           provider_account_id = EXCLUDED.provider_account_id,
           access_token_enc = EXCLUDED.access_token_enc,
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           expires_at = EXCLUDED.expires_at,
           connected_at = now()
         RETURNING *`,
        [
          input.userId,
          input.provider as SocialProvider,
          input.handle,
          input.providerAccountId,
          input.accessTokenEnc,
          input.refreshTokenEnc,
          input.expiresAt
        ]
      );
      return toRow(rows[0])!;
    },

    async deleteConnection(userId, provider) {
      await pool.query(`DELETE FROM social_connections WHERE user_id = $1 AND provider = $2`, [userId, provider]);
    }
  };
}
