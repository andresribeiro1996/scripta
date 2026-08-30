// Typed errors the library domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts and modules/gallery/domain/errors.ts.

export class LibraryError extends Error {}

export class NoLibraryDocumentError extends LibraryError {
  constructor() {
    super("No library saved yet — there's nothing to share.");
  }
}
