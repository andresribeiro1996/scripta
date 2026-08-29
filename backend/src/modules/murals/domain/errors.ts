// Typed errors the murals domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts and modules/gallery/domain/errors.ts.

export class MuralError extends Error {}

export class MuralNotFoundError extends MuralError {
  constructor() {
    super("No mural with that id.");
  }
}
