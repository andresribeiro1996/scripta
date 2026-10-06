export class LibraryConflictError extends Error {
  readonly status = 409;

  constructor() {
    super("The library changed elsewhere since this was loaded.");
  }
}
