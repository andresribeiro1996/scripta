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
  setAvatarId(userId: string, avatarId: string | null): void;
  /** No ownership filter — needed by the public, unauthenticated
   *  GET /auth/avatar/:id/file route to find which account's blob to
   *  read, keyed only by the unguessable avatar id (same trust model as
   *  gallery's getImageById). */
  findUserIdByAvatarId(avatarId: string): string | undefined;

  insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date }): string;
  findRefreshTokenByHash(tokenHash: string): RefreshTokenRow | undefined;
  revokeRefreshToken(id: string): void;
  revokeAllRefreshTokensForUser(userId: string): void;
}

/** Raw avatar image bytes on disk. Always exactly one per user (or none),
 *  addressed by a server-generated id — see types.ts's AuthenticatedUser.
 *  Output format is fixed (webp) by the service, so no extension parameter. */
export interface AvatarBlobStore {
  save(userId: string, avatarId: string, bytes: Buffer): void;
  read(userId: string, avatarId: string): Buffer | null;
  delete(userId: string, avatarId: string): void;
}
