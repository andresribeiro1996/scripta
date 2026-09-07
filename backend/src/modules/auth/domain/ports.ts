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

  insertRefreshToken(input: { userId: string; tokenHash: string; expiresAt: Date; grantedViaGrace?: boolean }): string;
  findRefreshTokenByHash(tokenHash: string): RefreshTokenRow | undefined;
  /** Needed by the refresh-rotation grace window (service.ts) to follow a
   *  rotated-away token's replaced_by pointer to the row it became. */
  findRefreshTokenById(id: string): RefreshTokenRow | undefined;
  /** Plain logout revocation — leaves rotated_at/replaced_by both null, so
   *  a token revoked this way never qualifies for the grace-window
   *  reissue below. Used for /auth/logout and the theft/replay
   *  revoke-all path in service.ts's refresh(). */
  revokeRefreshToken(id: string): void;
  /** Same effect as revokeRefreshToken, but records WHEN (rotated_at) and
   *  INTO WHAT (replaced_by) — the bookkeeping that lets refresh()
   *  distinguish "the client just hasn't seen its new pair yet" from
   *  "this token was revoked for a real reason" within a short grace
   *  window after normal rotation. `grantedViaGrace` marks the chain as
   *  having used its single grace hop. */
  rotateRefreshToken(id: string, replacedByTokenId: string, options?: { grantedViaGrace?: boolean }): void;
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
