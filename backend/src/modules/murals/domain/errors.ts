import { LocalizedError } from "../../../i18n/index.js";

export class InvalidFolderReferenceError extends LocalizedError {
  constructor() {
    super("murals.folderMissing");
    this.name = "InvalidFolderReferenceError";
  }
}

export class FolderCycleError extends LocalizedError {
  constructor() {
    super("murals.folderCycle");
    this.name = "FolderCycleError";
  }
}

export class MuralConflictError extends LocalizedError {
  constructor() {
    super("murals.conflict");
    this.name = "MuralConflictError";
  }
}

export class MuralNameTooLongError extends LocalizedError {
  constructor() {
    super("murals.nameTooLong");
    this.name = "MuralNameTooLongError";
  }
}
