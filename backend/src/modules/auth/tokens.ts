// JWT access tokens + opaque refresh tokens. Kept separate from service.ts
// so the token *mechanics* (signing, hashing, rotation) are easy to find
// and review independently of the account/credential logic that uses them.

import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { AccessTokenClaims, AuthenticatedUser, UserRow } from "./domain/types.js";

export function signAccessToken(user: Pick<UserRow, "id" | "email" | "username" | "avatar_id">): string {
  const claims: AccessTokenClaims = { sub: user.id, email: user.email, username: user.username, avatarId: user.avatar_id };
  // jsonwebtoken's own types narrow `expiresIn` to a template-literal
  // subset of strings it doesn't export a name for; env.ACCESS_TOKEN_TTL
  // is validated at startup (config/env.ts) to already be in that shape
  // ("15m", "1h", "30d", ...), so this cast isn't widening anything real.
  const options: jwt.SignOptions = { expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"] };
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenClaims;
  } catch {
    return null;
  }
}

/** Pure JWT verification — no repository/persistence involved, so this
 *  lives alongside the other token mechanics rather than in service.ts.
 *  Used directly by guard.ts, which therefore doesn't need the composed
 *  AuthService at all, just this. */
export function getAuthenticatedUserFromAccessToken(accessToken: string): AuthenticatedUser | null {
  const claims = verifyAccessToken(accessToken);
  if (!claims) return null;
  // `?? null` — tokens issued before avatars existed carry no avatarId claim.
  return { id: claims.sub, email: claims.email, username: claims.username, avatarId: claims.avatarId ?? null };
}

/** A refresh token is just high-entropy random data — it carries no
 *  claims itself. Its validity lives entirely in the refresh_tokens table
 *  (hash, expiry, revoked_at), which is what lets a single token be
 *  revoked instantly without waiting for it to expire. */
export function generateRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + parseDurationMs(env.REFRESH_TOKEN_TTL));
}

/** Parses simple "15m" / "30d" / "1h" style durations — the same format
 *  jsonwebtoken's `expiresIn` accepts, kept consistent on purpose. */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) {
    throw new Error(`Invalid duration "${duration}" — expected e.g. "15m", "1h", "30d".`);
  }
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return value * unitMs;
}
