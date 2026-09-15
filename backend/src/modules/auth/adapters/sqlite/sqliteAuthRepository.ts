// The SQLite implementation of the AuthRepository port. This is the only
// file in the auth module that knows SQL, or that a database called
// SQLite is even involved — service.ts only ever sees the AuthRepository
// interface this class fulfills.

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AccountToken, AuthRepository } from "../../domain/ports.js";
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
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, granted_via_grace) VALUES ($id, $user_id, $token_hash, $expires_at, $granted_via_grace)`
  );
  const findRefreshTokenByHashStmt = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`);
  const findRefreshTokenByIdStmt = db.prepare(`SELECT * FROM refresh_tokens WHERE id = ?`);
  const revokeRefreshTokenStmt = db.prepare(`UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE id = $id`);
  const rotateRefreshTokenStmt = db.prepare(
    `UPDATE refresh_tokens SET revoked_at = $revoked_at, rotated_at = $rotated_at, replaced_by = $replaced_by, granted_via_grace = $granted_via_grace WHERE id = $id`
  );
  const revokeAllForUserStmt = db.prepare(
    `UPDATE refresh_tokens SET revoked_at = $revoked_at WHERE user_id = $user_id AND revoked_at IS NULL`
  );

  function revokeSessions(userId: string) {
    db.prepare("UPDATE users SET auth_version = auth_version + 1 WHERE id = ?").run(userId);
    db.prepare("UPDATE refresh_tokens SET revoked_at = ?, rotated_at = NULL, replaced_by = NULL WHERE user_id = ?").run(new Date().toISOString(), userId);
    db.prepare("DELETE FROM account_tokens WHERE user_id = ?").run(userId);
  }

  function transaction(action: () => boolean): boolean {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    saveAccountToken(token) {
      const now = new Date().toISOString();
      db.prepare("DELETE FROM account_tokens WHERE expires_at <= ?").run(now);
      const result = db.prepare(`INSERT INTO account_tokens (user_id, purpose, email, token_hash, expires_at, requested_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, purpose) DO UPDATE SET email = excluded.email, token_hash = excluded.token_hash,
          expires_at = excluded.expires_at, requested_at = excluded.requested_at
        WHERE account_tokens.requested_at <= ?`).run(token.user_id, token.purpose, token.email, token.token_hash,
          token.expires_at, token.requested_at, new Date(Date.now() - 60_000).toISOString());
      return result.changes === 1;
    },
    findAccountToken(hash, purpose) {
      return db.prepare("SELECT * FROM account_tokens WHERE token_hash = ? AND purpose = ? AND expires_at > ?")
        .get(hash, purpose, new Date().toISOString()) as AccountToken | undefined;
    },
    completePasswordReset(hash, passwordHash) {
      return transaction(() => {
        const token = db.prepare("SELECT * FROM account_tokens WHERE token_hash = ? AND purpose = 'reset' AND expires_at > ?")
          .get(hash, new Date().toISOString()) as AccountToken | undefined;
        if (!token) return false;
        const result = db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND email = ? AND password_hash IS NOT NULL")
          .run(passwordHash, token.user_id, token.email);
        if (!result.changes) return false;
        revokeSessions(token.user_id);
        return true;
      });
    },
    changePassword(userId, previousHash, passwordHash) {
      return transaction(() => {
        const result = db.prepare("UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?").run(passwordHash, userId, previousHash);
        if (!result.changes) return false;
        revokeSessions(userId);
        return true;
      });
    },
    verifyEmail(hash) {
      return transaction(() => {
        const token = db.prepare("SELECT * FROM account_tokens WHERE token_hash = ? AND purpose = 'verify' AND expires_at > ?")
          .get(hash, new Date().toISOString()) as AccountToken | undefined;
        if (!token) return false;
        const user = findByIdStmt.get(token.user_id) as UserRow | undefined;
        if (!user) return false;
        const existing = findByEmailStmt.get(token.email) as UserRow | undefined;
        if (existing && existing.id !== user.id) return false;
        db.prepare("UPDATE users SET email = ?, email_verified_at = ? WHERE id = ?").run(token.email, new Date().toISOString(), user.id);
        if (user.email !== token.email) revokeSessions(user.id);
        else db.prepare("DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'verify'").run(user.id);
        return true;
      });
    },
    markEmailVerified(userId) {
      db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?").run(new Date().toISOString(), userId);
    },
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
        $expires_at: input.expiresAt.toISOString(),
        $granted_via_grace: input.grantedViaGrace ? 1 : 0
      });
      return id;
    },

    findRefreshTokenByHash(tokenHash) {
      return findRefreshTokenByHashStmt.get(tokenHash) as RefreshTokenRow | undefined;
    },

    findRefreshTokenById(id) {
      return findRefreshTokenByIdStmt.get(id) as RefreshTokenRow | undefined;
    },

    revokeRefreshToken(id) {
      revokeRefreshTokenStmt.run({ $id: id, $revoked_at: new Date().toISOString() });
    },

    rotateRefreshToken(id, replacedByTokenId, options) {
      const now = new Date().toISOString();
      rotateRefreshTokenStmt.run({
        $id: id,
        $revoked_at: now,
        $rotated_at: now,
        $replaced_by: replacedByTokenId,
        $granted_via_grace: options?.grantedViaGrace ? 1 : 0
      });
    },

    revokeAllRefreshTokensForUser(userId) {
      revokeAllForUserStmt.run({ $user_id: userId, $revoked_at: new Date().toISOString() });
    }
  };
}
