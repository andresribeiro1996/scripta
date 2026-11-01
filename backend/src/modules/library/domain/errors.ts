// Typed errors the library domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/auth/domain/errors.ts and modules/gallery/domain/errors.ts.

import { LocalizedError } from "../../../i18n/index.js";

export class LibraryError extends LocalizedError {}

export class NoLibraryDocumentError extends LibraryError {
  constructor() {
    super("library.noneToShare");
  }
}

export class LibraryConflictError extends LibraryError {
  constructor() {
    super("library.conflict");
  }
}

export class LibraryTooLargeError extends LibraryError {
  constructor() {
    super("library.overSizeLimit");
  }
}

export class LibraryChangeNotFoundError extends LibraryError {
  constructor(readonly reason: "no-group" | "no-book") {
    super(reason === "no-group" ? "library.noGroup" : "library.noBook");
  }
}

export class InvalidReaderCardChoiceError extends LibraryError {
  constructor(choice: "signature" | "highlight") {
    super(choice === "signature" ? "library.signatureNotFinished" : "library.highlightNotKobo");
  }
}
