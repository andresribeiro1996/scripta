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
