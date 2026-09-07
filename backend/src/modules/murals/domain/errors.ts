export class InvalidFolderReferenceError extends Error {
  constructor() {
    super("That folder doesn't exist.");
    this.name = "InvalidFolderReferenceError";
  }
}

export class FolderCycleError extends Error {
  constructor() {
    super("A folder can't be moved into itself or one of its own subfolders.");
    this.name = "FolderCycleError";
  }
}

export class MuralConflictError extends Error {
  constructor() {
    super("This mural changed elsewhere since it was loaded.");
    this.name = "MuralConflictError";
  }
}
