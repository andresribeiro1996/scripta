// Typed errors the auth domain can throw. routes.ts catches these and maps
// each to an HTTP status; nothing outside auth/ should need to know these
// exist, but EmailInUseError is re-exported from index.ts since a signup
// form calling this module's HTTP API is the more common integration path
// than importing this class directly.

export class AuthError extends Error {}

export class InvalidCredentialsError extends AuthError {
  constructor() {
    super("Invalid email or password.");
  }
}

export class EmailInUseError extends AuthError {
  constructor(email: string) {
    super(`An account with email "${email}" already exists.`);
  }
}

export class UsernameInUseError extends AuthError {
  constructor(username: string) {
    super(`Username "${username}" is already taken.`);
  }
}

export class InvalidRefreshTokenError extends AuthError {
  constructor() {
    super("Refresh token is invalid, expired, or already used.");
  }
}

export class OAuthAccountConflictError extends AuthError {
  constructor(email: string) {
    super(`An account with email "${email}" already exists with a different sign-in method.`);
  }
}

// Avatar uploads — same shape as gallery's upload errors (modules/gallery/
// domain/errors.ts), duplicated rather than shared so the two modules stay
// independently swappable, per the module-isolation rule in backend/README.
export class AvatarError extends AuthError {}

export class AvatarTooLargeError extends AvatarError {
  constructor(maxBytes: number) {
    super(`Avatar must be at most ${Math.floor(maxBytes / (1024 * 1024))} MB.`);
  }
}

export class InvalidAvatarError extends AvatarError {
  constructor() {
    super("That file doesn't look like a supported image.");
  }
}

export class AvatarDimensionsTooLargeError extends AvatarError {
  constructor(maxDimension: number) {
    super(`Avatar image is too large — at most ${maxDimension}px per side.`);
  }
}
