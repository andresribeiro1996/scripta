// The port: everything the auth domain (service.ts) needs from
// persistence, expressed as an interface — never as "SQLite" or "a
// database" specifically. service.ts is written against this interface
// only; it has no idea what's on the other side of it.
//
// Swapping storage (SQLite → Postgres, or a fake for unit tests) means
// writing a new class that implements AuthRepository and handing it to
// createAuthService() in plugin.ts — service.ts doesn't change at all.
//
// Every method is async even though the SQLite adapter answers
// synchronously, for the same reason modules/library's port is: a
// network-backed store cannot answer synchronously, and a port that
// promised it could would have made adapters/postgres/ a rewrite of
// service.ts rather than a new folder.

import type { RefreshTokenRow, UserRow } from "./types.js";

export interface AuthRepository {
  createUser(input: { email: string; username: string | null; passwordHash: string | null; googleId: string | null }): Promise<UserRow>;
  findUserByEmail(email: string): Promise<UserRow | undefined>;
  findUserByUsername(username: string): Promise<UserRow | undefined>;
  findUserById(id: string): Promise<UserRow | undefined>;
  findUserByGoogleId(googleId: string): Promise<UserRow | undefined>;
  linkGoogleId(userId: string, googleId: string): Promise<void>;
  setUsername(userId: string, username: string): Promise<void>;

  insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<string>;
  findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenRow | undefined>;
  revokeRefreshToken(id: string): Promise<void>;
  revokeAllRefreshTokensForUser(userId: string): Promise<void>;
}
