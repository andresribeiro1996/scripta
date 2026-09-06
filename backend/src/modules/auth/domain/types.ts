// Domain types for the auth module. Only `AuthenticatedUser` (and the
// error classes in errors.ts) are re-exported from index.ts for other
// modules to use — everything else here stays private to auth/.

export interface UserRow {
  id: string;
  email: string;
  username: string | null;
  password_hash: string | null;
  google_id: string | null;
  avatar_id: string | null;
  created_at: string;
}

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

/** The shape attached to `request.user` by the auth guard — this is the
 *  one type other modules are meant to depend on. `username` is null for
 *  an account that hasn't picked one yet (only possible via Google sign-in
 *  — password signup requires one immediately). */
export interface AuthenticatedUser {
  id: string;
  email: string;
  username: string | null;
  /** Server-generated id of the account's avatar image, served (unauthenticated,
   *  same UUID-trust model as gallery) at GET /auth/avatar/:id/file. NULL until
   *  one is uploaded — the frontend renders an initial in that case. Regenerated
   *  on every replacement, so the file URL changes and immutable caching stays
   *  correct. Note: in `request.user` (built from JWT claims by guard.ts) this
   *  can be briefly stale after an avatar change until the access token is
   *  reissued — it's identity data for display, not an ownership check, so
   *  staleness is harmless; the avatar endpoints themselves return a fresh user. */
  avatarId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AccessTokenClaims {
  sub: string; // user id
  email: string;
  username: string | null;
  avatarId: string | null; // can be stale until the token is reissued — see AuthenticatedUser
}
