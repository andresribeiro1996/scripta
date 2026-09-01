// The SQLite implementation of the AuthRepository port. This is the only
// file in the auth module that knows SQL, or that a database called
// SQLite is even involved — service.ts only ever sees the AuthRepository
// interface this class fulfills.

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuthRepository } from "../../domain/ports.js";
import type { RefreshTokenRow, UserRow } from "../../domain/types.js";

// Every method is declared async to satisfy the port; nothing here
// awaits, since node:sqlite is a synchronous API. See domain/ports.ts.
export function createSqliteAuthRepository(db: DatabaseSync): AuthRepository {
  const insertUserStmt = db.prepare(
    `INSERT INTO users (id, email, username, password_hash, google_id) VALUES ($id, $email, $username, $password_hash, $google_id)`
  );
  const findByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
  const findByUsernameStmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const findByGoogleIdStmt = db.prepare(`SELECT * FROM users WHERE google_id = ?`);
  const linkGoogleIdStmt = db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`);
  const setUsernameStmt = db.prepare(`UPDATE users SET username = ? WHERE id = ?`);

  const insertRefreshTokenStmt = db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($id, $user_id, $token_hash, $expires_at)`
  );
  const findRefreshTokenByHashStmt = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`);
  // `AND revoked_at IS NULL` so a second revoke of the same token leaves
  // the ORIGINAL timestamp alone. service.ts treats "already revoked" as
  // evidence of a stolen-and-replayed token; overwriting the timestamp
  // would keep that signal but lose when the token was first revoked,
  // which is exactly what an incident review needs. Matches the Postgres
  // adapter, which had the guard from the start.
  const revokeRefreshTokenStmt = db.prepare(
    `UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE id = $id AND revoked_at IS NULL`
  );
  const revokeAllForUserStmt = db.prepare(
    `UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE user_id = $user_id AND revoked_at IS NULL`
  );

  return {
    async createUser(input) {
      const row: UserRow = {
        id: randomUUID(),
        email: input.email,
        username: input.username,
        password_hash: input.passwordHash,
        google_id: input.googleId,
        created_at: new Date().toISOString()
      };
      insertUserStmt.run({
        $id: row.id,
        $email: row.email,
        $username: row.username,
        $password_hash: row.password_hash,
        $google_id: row.google_id
      });
      return row;
    },

    async findUserByEmail(email) {
      return findByEmailStmt.get(email) as UserRow | undefined;
    },

    async findUserByUsername(username) {
      return findByUsernameStmt.get(username) as UserRow | undefined;
    },

    async findUserById(id) {
      return findByIdStmt.get(id) as UserRow | undefined;
    },

    async findUserByGoogleId(googleId) {
      return findByGoogleIdStmt.get(googleId) as UserRow | undefined;
    },

    async linkGoogleId(userId, googleId) {
      linkGoogleIdStmt.run(googleId, userId);
    },

    async setUsername(userId, username) {
      setUsernameStmt.run(username, userId);
    },

    async insertRefreshToken(input) {
      const id = randomUUID();
      insertRefreshTokenStmt.run({
        $id: id,
        $user_id: input.userId,
        $token_hash: input.tokenHash,
        $expires_at: input.expiresAt.toISOString()
      });
      return id;
    },

    async findRefreshTokenByHash(tokenHash) {
      return findRefreshTokenByHashStmt.get(tokenHash) as RefreshTokenRow | undefined;
    },

    async revokeRefreshToken(id) {
      revokeRefreshTokenStmt.run({ $id: id, $revoked_at: new Date().toISOString() });
    },

    async revokeAllRefreshTokensForUser(userId) {
      revokeAllForUserStmt.run({ $user_id: userId, $revoked_at: new Date().toISOString() });
    }
  };
}
