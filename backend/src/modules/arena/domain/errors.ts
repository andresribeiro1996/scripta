// Typed errors the arena domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/gallery/domain/errors.ts.

import { LocalizedError } from "../../../i18n/index.js";

export class ArenaError extends LocalizedError {}

export class TournamentNotFoundError extends ArenaError {
  constructor() {
    super("arena.tournamentNotFound");
  }
}

export class TournamentAlreadyStartedError extends ArenaError {
  constructor() {
    super("arena.alreadyStarted");
  }
}

export class InvalidBracketSizeError extends ArenaError {
  constructor() {
    super("arena.invalidBracketSize");
  }
}

export class IncompleteSeedError extends ArenaError {
  constructor(expected: number, actual: number) {
    super("arena.incompleteSeed", { expected, actual });
  }
}

export class NotEnoughBooksError extends ArenaError {
  constructor(expected: number, actual: number) {
    super("arena.notEnoughBooks", { expected, actual });
  }
}

export class DuplicateSlotError extends ArenaError {
  constructor() {
    super("arena.duplicateSlot");
  }
}

export class InvalidSlotIndexError extends ArenaError {
  constructor(bracketSize: number) {
    super("arena.invalidSlotIndex", { max: bracketSize - 1 });
  }
}

export class DuplicateBookError extends ArenaError {
  constructor(title?: string) {
    if (title) super("works.duplicateEdition", { title });
    else super("arena.duplicateBook");
  }
}

export class DuelNotFoundError extends ArenaError {
  constructor() {
    super("arena.duelNotFound");
  }
}

export class DuelNotVotableError extends ArenaError {
  constructor() {
    super("arena.duelNotVotable");
  }
}

export class InvalidBookError extends ArenaError {
  constructor() {
    super("arena.invalidBook");
  }
}

export class AlreadyVotedError extends ArenaError {
  constructor() {
    super("arena.alreadyVoted");
  }
}

export class DuelNotTiedError extends ArenaError {
  constructor() {
    super("arena.duelNotTied");
  }
}

export class InvalidCharacterSelectionError extends ArenaError {
  constructor(key: "arena.characterBracketMin" | "arena.characterCountMin" | "arena.characterDuplicate" | "arena.noCast" | "arena.characterNotInCast") {
    super(key);
  }
}
