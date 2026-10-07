// Typed errors the library domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts and modules/gallery/domain/errors.ts.

export class LibraryError extends Error {}

export class NoLibraryDocumentError extends LibraryError {
  constructor() {
    super("No library saved yet — there's nothing to share.");
  }
}

export class LibraryConflictError extends LibraryError {
  constructor() {
    super("The library changed elsewhere since it was loaded.");
  }
}

export class LibraryTooLargeError extends LibraryError {
  constructor() {
    super("The library would be over the size limit.");
  }
}

export class LibraryChangeNotFoundError extends LibraryError {
  constructor(readonly reason: "no-group" | "no-book") {
    super(reason === "no-group" ? "That group isn't in your library." : "That book isn't in your library.");
  }
}

export class InvalidReaderCardChoiceError extends LibraryError {
  constructor(choice: "signature" | "highlight") {
    super(choice === "signature" ? "The signature book has to be a finished book in your library." : "The highlight has to be one of your Kobo highlights.");
  }
}
