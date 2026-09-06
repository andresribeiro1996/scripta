// Business logic for the auth module — the domain/application layer of
// the hexagon. Depends only on the AuthRepository *port* (domain/ports.ts),
// never on SQLite or any concrete storage — plugin.ts (the composition
// root) is what decides which adapter actually backs it. That's what
// makes this layer trivially unit-testable with an in-memory fake
// repository, and what makes swapping SQLite for Postgres later a change
// contained entirely to adapters/, never touching this file.

import * as argon2 from "argon2";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  AvatarDimensionsTooLargeError,
  AvatarTooLargeError,
  EmailInUseError,
  InvalidAvatarError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  OAuthAccountConflictError,
  UsernameInUseError
} from "./domain/errors.js";
import type { AuthRepository, AvatarBlobStore } from "./domain/ports.js";
import type { AuthenticatedUser, TokenPair, UserRow } from "./domain/types.js";
import { generateRefreshToken, hashRefreshToken, refreshTokenExpiry, signAccessToken } from "./tokens.js";

export interface AuthService {
  signup(email: string, username: string, password: string): Promise<{ user: AuthenticatedUser; tokens: TokenPair }>;
  /** `identifier` is checked against both email and username — either
   *  logs in the same account. */
  login(identifier: string, password: string): Promise<{ user: AuthenticatedUser; tokens: TokenPair }>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string): void;
  logoutEverywhere(userId: string): void;
  loginWithGoogle(profile: { googleId: string; email: string }): Promise<{ user: AuthenticatedUser; tokens: TokenPair }>;
  /** Claims a username for an already-authenticated user — the path a
   *  Google sign-in without one yet uses on its first login. Works
   *  equally for a password account, though nothing currently prompts
   *  one to change theirs (it's set once, at signup). */
  setUsername(userId: string, username: string): Promise<AuthenticatedUser>;
  getUserById(userId: string): AuthenticatedUser | null;
  /** Validates, square-crops, and re-encodes an uploaded profile picture
   *  (same pipeline reasoning as gallery's uploadImage — magic-byte sniff,
   *  EXIF strip via re-encode, server-generated id), replaces any previous
   *  avatar, and returns the fresh user. */
  setAvatar(userId: string, buffer: Buffer): Promise<AuthenticatedUser>;
  removeAvatar(userId: string): Promise<AuthenticatedUser>;
  /** No ownership check — backs the public GET /auth/avatar/:id/file
   *  route (UUID-addressed, gallery's trust model). */
  getAvatarFile(avatarId: string): { buffer: Buffer; mimeType: string } | null;
}

// Personal/family-scale limits, same reasoning as gallery's constants.
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_INPUT_DIMENSION = 8000;
const AVATAR_SIZE = 256;
const AVATAR_QUALITY = 85;
const AVATAR_MIME_TYPE = "image/webp";

function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return { id: row.id, email: row.email, username: row.username, avatarId: row.avatar_id };
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function createAuthService(repo: AuthRepository, avatarStore: AvatarBlobStore): AuthService {
  async function issueTokenPair(user: UserRow): Promise<TokenPair> {
    const accessToken = signAccessToken(user);
    const refreshToken = generateRefreshToken();
    repo.insertRefreshToken({
      userId: user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiry()
    });
    return { accessToken, refreshToken };
  }

  return {
    async signup(email, username, password) {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedUsername = normalizeUsername(username);
      if (repo.findUserByEmail(normalizedEmail)) {
        throw new EmailInUseError(normalizedEmail);
      }
      if (repo.findUserByUsername(normalizedUsername)) {
        throw new UsernameInUseError(normalizedUsername);
      }
      const passwordHash = await argon2.hash(password);
      const user = repo.createUser({ email: normalizedEmail, username: normalizedUsername, passwordHash, googleId: null });
      const tokens = await issueTokenPair(user);
      return { user: toAuthenticatedUser(user), tokens };
    },

    async login(identifier, password) {
      const normalized = identifier.trim().toLowerCase();
      const user = repo.findUserByEmail(normalized) ?? repo.findUserByUsername(normalized);
      // Same error for "no such user" and "wrong password" — don't leak
      // which one it was, that's an account-enumeration side channel.
      if (!user || !user.password_hash) {
        throw new InvalidCredentialsError();
      }
      const valid = await argon2.verify(user.password_hash, password);
      if (!valid) {
        throw new InvalidCredentialsError();
      }
      const tokens = await issueTokenPair(user);
      return { user: toAuthenticatedUser(user), tokens };
    },

    /** Refresh token rotation: the presented token is revoked and a fresh
     *  pair issued, every time. If a token is presented that's already
     *  revoked, that's a signal it was stolen and replayed (the
     *  legitimate client would only ever have the latest one) — so every
     *  other session for that user is revoked too, forcing a re-login
     *  everywhere. */
    async refresh(refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const row = repo.findRefreshTokenByHash(tokenHash);

      if (!row) throw new InvalidRefreshTokenError();

      if (row.revoked_at || new Date(row.expires_at) < new Date()) {
        if (row.revoked_at) repo.revokeAllRefreshTokensForUser(row.user_id);
        throw new InvalidRefreshTokenError();
      }

      const user = repo.findUserById(row.user_id);
      if (!user) throw new InvalidRefreshTokenError();

      repo.revokeRefreshToken(row.id);
      return issueTokenPair(user);
    },

    logout(refreshToken) {
      const row = repo.findRefreshTokenByHash(hashRefreshToken(refreshToken));
      if (row) repo.revokeRefreshToken(row.id);
    },

    logoutEverywhere(userId) {
      repo.revokeAllRefreshTokensForUser(userId);
    },

    /** Find-or-create for a Google profile. If the email already has a
     *  password-only account, this links Google to it rather than
     *  silently creating a duplicate — but only implicitly for a
     *  first-time Google login; if a *different* google_id is already
     *  linked elsewhere for that email, something's inconsistent and we
     *  refuse rather than guess. A brand-new account gets no username
     *  yet — the frontend routes a user in that state to a
     *  choose-a-username screen before letting them any further in. */
    async loginWithGoogle(profile) {
      const normalizedEmail = profile.email.trim().toLowerCase();

      let user = repo.findUserByGoogleId(profile.googleId);

      if (!user) {
        const byEmail = repo.findUserByEmail(normalizedEmail);
        if (byEmail) {
          if (byEmail.google_id && byEmail.google_id !== profile.googleId) {
            throw new OAuthAccountConflictError(normalizedEmail);
          }
          repo.linkGoogleId(byEmail.id, profile.googleId);
          user = { ...byEmail, google_id: profile.googleId };
        } else {
          user = repo.createUser({ email: normalizedEmail, username: null, passwordHash: null, googleId: profile.googleId });
        }
      }

      const tokens = await issueTokenPair(user);
      return { user: toAuthenticatedUser(user), tokens };
    },

    async setUsername(userId, username) {
      const normalizedUsername = normalizeUsername(username);
      const existing = repo.findUserByUsername(normalizedUsername);
      if (existing && existing.id !== userId) {
        throw new UsernameInUseError(normalizedUsername);
      }
      repo.setUsername(userId, normalizedUsername);
      const user = repo.findUserById(userId);
      // Shouldn't happen — this is only reachable via authGuard, which
      // already proved the caller's id exists — but fail loudly rather
      // than silently return something wrong if it ever does.
      if (!user) throw new Error(`setUsername: user ${userId} vanished mid-request.`);
      return toAuthenticatedUser(user);
    },

    getUserById(userId) {
      const user = repo.findUserById(userId);
      return user ? toAuthenticatedUser(user) : null;
    },

    async setAvatar(userId, buffer) {
      if (buffer.byteLength > MAX_AVATAR_UPLOAD_BYTES) throw new AvatarTooLargeError(MAX_AVATAR_UPLOAD_BYTES);

      // Real-format sniff via the file header, not the client MIME type —
      // same "verify by magic bytes" check as gallery's upload pipeline.
      let metadata;
      try {
        metadata = await sharp(buffer).metadata();
      } catch {
        throw new InvalidAvatarError();
      }
      if (!metadata.width || !metadata.height || !metadata.format) throw new InvalidAvatarError();
      if (metadata.width > MAX_AVATAR_INPUT_DIMENSION || metadata.height > MAX_AVATAR_INPUT_DIMENSION) {
        throw new AvatarDimensionsTooLargeError(MAX_AVATAR_INPUT_DIMENSION);
      }

      // .rotate() applies the EXIF orientation before the re-encode drops
      // that EXIF data; fit: "cover" center-crops to a square (no client-side
      // cropping step needed, and no crop library in the frontend).
      const encoded = await sharp(buffer)
        .rotate()
        .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
        .webp({ quality: AVATAR_QUALITY })
        .toBuffer();

      const user = repo.findUserById(userId);
      if (!user) throw new Error(`setAvatar: user ${userId} vanished mid-request.`);

      const avatarId = randomUUID();
      avatarStore.save(userId, avatarId, encoded);
      repo.setAvatarId(userId, avatarId);
      if (user.avatar_id) avatarStore.delete(userId, user.avatar_id);
      return toAuthenticatedUser({ ...user, avatar_id: avatarId });
    },

    async removeAvatar(userId) {
      const user = repo.findUserById(userId);
      if (!user) throw new Error(`removeAvatar: user ${userId} vanished mid-request.`);
      if (user.avatar_id) {
        repo.setAvatarId(userId, null);
        avatarStore.delete(userId, user.avatar_id);
      }
      // `user` was fetched before the column was cleared — project the
      // cleared state onto it rather than re-fetching.
      return toAuthenticatedUser({ ...user, avatar_id: null });
    },

    getAvatarFile(avatarId) {
      const userId = repo.findUserIdByAvatarId(avatarId);
      if (!userId) return null;
      const buffer = avatarStore.read(userId, avatarId);
      if (!buffer) return null;
      return { buffer, mimeType: AVATAR_MIME_TYPE };
    }
  };
}
