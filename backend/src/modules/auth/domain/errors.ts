// Typed errors the auth domain can throw. routes.ts catches these and maps
// each to an HTTP status; nothing outside auth/ should need to know these
// exist, but EmailInUseError is re-exported from index.ts since a signup
// form calling this module's HTTP API is the more common integration path
// than importing this class directly.

import { LocalizedError } from "../../../i18n/index.js";

export class AuthError extends LocalizedError {}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("auth.invalidCredentials");
  }
}

export class EmailInUseError extends AuthError {
  constructor(email: string) {
    super("auth.emailInUse", { email });
  }
}

export class UsernameInUseError extends AuthError {
  constructor(username: string) {
    super("auth.usernameInUse", { username });
  }
}

export class InvalidRefreshTokenError extends AuthError {
  constructor() {
    super("auth.invalidRefreshToken");
  }
}

export class OAuthAccountConflictError extends AuthError {
  constructor(email: string) {
    super("auth.oauthConflict", { email });
  }
}

// Avatar uploads — same shape as gallery's upload errors (modules/gallery/
// domain/errors.ts), duplicated rather than shared so the two modules stay
// independently swappable, per the module-isolation rule in backend/README.
export class AvatarError extends AuthError {}

export class AvatarTooLargeError extends AvatarError {
  constructor(maxBytes: number) {
    super("auth.avatarTooLarge", { mb: Math.floor(maxBytes / (1024 * 1024)) });
  }
}

export class InvalidAvatarError extends AvatarError {
  constructor() {
    super("auth.invalidAvatar");
  }
}

export class AvatarDimensionsTooLargeError extends AvatarError {
  constructor(maxDimension: number) {
    super("auth.avatarDimensions", { px: maxDimension });
  }
}
