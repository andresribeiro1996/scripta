// The port: everything the auth domain (service.ts) needs from
// persistence, expressed as an interface — never as "SQLite" or "a
// database" specifically. service.ts is written against this interface
// only; it has no idea what's on the other side of it.
//
// Swapping storage (SQLite → Postgres, or a fake for unit tests) means
// writing a new class that implements AuthRepository and handing it to
// createAuthService() in plugin.ts — service.ts doesn't change at all.

import type { RefreshTokenRow, UserRow } from "./types.js";

export interface AuthRepository {
  createUser(input: { email: string; username: string | null; passwordHash: string | null; googleId: string | null }): UserRow;
  findUserByEmail(email: string): UserRow | undefined;
  findUserByUsername(username: string): UserRow | undefined;
  findUserById(id: string): UserRow | undefined;
  findUserByGoogleId(googleId: string): UserRow | undefined;
  linkGoogleId(userId: string, googleId: string): void;
  setUsername(userId: string, username: string): void;

  insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }): string;
  findRefreshTokenByHash(tokenHash: string): RefreshTokenRow | undefined;
  revokeRefreshToken(id: string): void;
  revokeAllRefreshTokensForUser(userId: string): void;
}
