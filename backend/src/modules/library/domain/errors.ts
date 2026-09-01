// Typed errors the library domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/gallery/domain/errors.ts and modules/auth/domain/errors.ts.

export class LibraryError extends Error {}

/** The caller sent a write based on a version of the library that is no
 *  longer current — someone else (usually the same person on another
 *  device) saved in between.
 *
 *  This is the error that exists to stop the silent data loss the old
 *  unconditional last-write-wins PUT caused: two devices open, both
 *  saving, one of them's changes vanishing with nobody told. Carries the
 *  current version and document so the caller can re-apply its change on
 *  top of the newer state instead of having to throw the user's edit
 *  away. */
export class LibraryVersionConflictError extends LibraryError {
  constructor(
    readonly expectedVersion: number,
    readonly currentVersion: number
  ) {
    super(
      `This library was changed elsewhere (you have version ${expectedVersion}, the server has ${currentVersion}). Re-apply your change to the current version.`
    );
  }
}

/** A per-entity write named something that isn't there — a mural or block
 *  that was deleted on another device, most likely. */
export class LibraryEntityNotFoundError extends LibraryError {
  constructor(what: string) {
    super(`${what} no longer exists — it may have been deleted on another device.`);
  }
}
