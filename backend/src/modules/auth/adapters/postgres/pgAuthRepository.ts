// The Postgres implementation of the AuthRepository port. A sibling of
// adapters/sqlite/, not a replacement — service.ts is untouched by this
// file existing, which is what the ports/adapters split was for.
//
// This is the adapter that matters most for scaling: `auth` was the last
// module keeping account data on local disk, and a SQLite file on a volume
// can only attach to one machine. With this, plus library's, the accounts
// table is no longer what pins the API to a single instance.

import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AuthRepository } from "../../domain/ports.js";
import type { RefreshTokenRow, UserRow } from "../../domain/types.js";

/** The domain speaks ISO strings for timestamps (that is what SQLite
 *  stores and what the rest of the app reads); node-postgres hands back
 *  Date objects. Normalising here keeps that difference inside the
 *  adapter, where it belongs. */
function toRow<T extends { created_at?: unknown }>(raw: Record<string, unknown> | undefined): T | undefined {
  if (!raw) return undefined;
  const normalised: Record<string, unknown> = { ...raw };
  for (const key of ["created_at", "expires_at", "revoked_at"]) {
    const value = normalised[key];
    if (value instanceof Date) normalised[key] = value.toISOString();
  }
  return normalised as T;
}

export function createPgAuthRepository(pool: Pool): AuthRepository {
  return {
    async createUser(input) {
      const id = randomUUID();
      const { rows } = await pool.query(
        `INSERT INTO users (id, email, username, password_hash, google_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, input.email, input.username, input.passwordHash, input.googleId]
      );
      // RETURNING rather than reconstructing the row in JS: created_at is
      // the database's DEFAULT now(), so building it here would report a
      // timestamp that isn't the one actually stored.
      return toRow<UserRow>(rows[0])!;
    },

    async findUserByEmail(email) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
      return toRow<UserRow>(rows[0]);
    },

    async findUserByUsername(username) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
      return toRow<UserRow>(rows[0]);
    },

    async findUserById(id) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
      return toRow<UserRow>(rows[0]);
    },

    async findUserByGoogleId(googleId) {
      const { rows } = await pool.query(`SELECT * FROM users WHERE google_id = $1`, [googleId]);
      return toRow<UserRow>(rows[0]);
    },

    async linkGoogleId(userId, googleId) {
      await pool.query(`UPDATE users SET google_id = $1 WHERE id = $2`, [googleId, userId]);
    },

    async setUsername(userId, username) {
      await pool.query(`UPDATE users SET username = $1 WHERE id = $2`, [username, userId]);
    },

    async insertRefreshToken(input) {
      const id = randomUUID();
      await pool.query(`INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
        id,
        input.userId,
        input.tokenHash,
        input.expiresAt.toISOString()
      ]);
      return id;
    },

    async findRefreshTokenByHash(tokenHash) {
      const { rows } = await pool.query(`SELECT * FROM refresh_tokens WHERE token_hash = $1`, [tokenHash]);
      return toRow<RefreshTokenRow>(rows[0]);
    },

    async revokeRefreshToken(id) {
      // Only revoke a token that is still live. Without the IS NULL guard
      // a replayed refresh would move revoked_at forward, quietly hiding
      // the fact that the token had already been used once — which is the
      // signal service.ts uses to detect a stolen token and log the
      // account out everywhere.
      await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
    },

    async revokeAllRefreshTokensForUser(userId) {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    }
  };
}
