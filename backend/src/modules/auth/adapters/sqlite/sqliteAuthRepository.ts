// The SQLite implementation of the AuthRepository port. This is the only
// file in the auth module that knows SQL, or that a database called
// SQLite is even involved — service.ts only ever sees the AuthRepository
// interface this class fulfills.

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuthRepository } from "../../domain/ports.js";
import type { RefreshTokenRow, UserRow } from "../../domain/types.js";

export function createSqliteAuthRepository(db: DatabaseSync): AuthRepository {
  const insertUserStmt = db.prepare(
    `INSERT INTO users (id, email, username, password_hash, google_id, avatar_id) VALUES ($id, $email, $username, $password_hash, $google_id, $avatar_id)`
  );
  const findByEmailStmt = db.prepare(`SELECT * FROM users WHERE email = ?`);
  const findByUsernameStmt = db.prepare(`SELECT * FROM users WHERE username = ?`);
  const findByIdStmt = db.prepare(`SELECT * FROM users WHERE id = ?`);
  const findByGoogleIdStmt = db.prepare(`SELECT * FROM users WHERE google_id = ?`);
  const linkGoogleIdStmt = db.prepare(`UPDATE users SET google_id = ? WHERE id = ?`);
  const setUsernameStmt = db.prepare(`UPDATE users SET username = ? WHERE id = ?`);
  const setAvatarIdStmt = db.prepare(`UPDATE users SET avatar_id = ? WHERE id = ?`);
  const findUserIdByAvatarIdStmt = db.prepare(`SELECT id FROM users WHERE avatar_id = ?`);

  const insertRefreshTokenStmt = db.prepare(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($id, $user_id, $token_hash, $expires_at)`
  );
  const findRefreshTokenByHashStmt = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`);
  const revokeRefreshTokenStmt = db.prepare(`UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE id = $id`);
  const revokeAllForUserStmt = db.prepare(
    `UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE user_id = $user_id AND revoked_at IS NULL`
  );

  return {
    createUser(input) {
      const row: UserRow = {
        id: randomUUID(),
        email: input.email,
        username: input.username,
        password_hash: input.passwordHash,
        google_id: input.googleId,
        avatar_id: null,
        created_at: new Date().toISOString()
      };
      insertUserStmt.run({
        $id: row.id,
        $email: row.email,
        $username: row.username,
        $password_hash: row.password_hash,
        $google_id: row.google_id,
        $avatar_id: row.avatar_id
      });
      return row;
    },

    findUserByEmail(email) {
      return findByEmailStmt.get(email) as UserRow | undefined;
    },

    findUserByUsername(username) {
      return findByUsernameStmt.get(username) as UserRow | undefined;
    },

    findUserById(id) {
      return findByIdStmt.get(id) as UserRow | undefined;
    },

    findUserByGoogleId(googleId) {
      return findByGoogleIdStmt.get(googleId) as UserRow | undefined;
    },

    linkGoogleId(userId, googleId) {
      linkGoogleIdStmt.run(googleId, userId);
    },

    setUsername(userId, username) {
      setUsernameStmt.run(username, userId);
    },

    setAvatarId(userId, avatarId) {
      setAvatarIdStmt.run(avatarId, userId);
    },

    findUserIdByAvatarId(avatarId) {
      const row = findUserIdByAvatarIdStmt.get(avatarId) as { id: string } | undefined;
      return row?.id;
    },

    insertRefreshToken(input) {
      const id = randomUUID();
      insertRefreshTokenStmt.run({
        $id: id,
        $user_id: input.userId,
        $token_hash: input.tokenHash,
        $expires_at: input.expiresAt.toISOString()
      });
      return id;
    },

    findRefreshTokenByHash(tokenHash) {
      return findRefreshTokenByHashStmt.get(tokenHash) as RefreshTokenRow | undefined;
    },

    revokeRefreshToken(id) {
      revokeRefreshTokenStmt.run({ $id: id, $revoked_at: new Date().toISOString() });
    },

    revokeAllRefreshTokensForUser(userId) {
      revokeAllForUserStmt.run({ $user_id: userId, $revoked_at: new Date().toISOString() });
    }
  };
}
