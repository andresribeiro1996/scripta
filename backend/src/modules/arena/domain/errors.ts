// Typed errors the arena domain can throw. routes.ts catches these and
// maps each to an HTTP status — same convention as
// modules/gallery/domain/errors.ts.

export class ArenaError extends Error {}

export class TournamentNotFoundError extends ArenaError {
  constructor() {
    super("No tournament with that id, or you don't own it.");
  }
}

export class TournamentAlreadyStartedError extends ArenaError {
  constructor() {
    super("This tournament has already started or completed.");
  }
}

export class InvalidBracketSizeError extends ArenaError {
  constructor() {
    super("Bracket size must be a power of two, at least 2 (e.g. 4, 8, 16, 32).");
  }
}

export class IncompleteSeedError extends ArenaError {
  constructor(expected: number, actual: number) {
    super(`This bracket needs ${expected} seeded books before it can start (currently ${actual}).`);
  }
}

export class NotEnoughBooksError extends ArenaError {
  constructor(expected: number, actual: number) {
    super(`Random-fill needs at least ${expected} candidate books (got ${actual}).`);
  }
}

export class DuplicateSlotError extends ArenaError {
  constructor() {
    super("Each bracket slot can only be assigned once.");
  }
}

export class InvalidSlotIndexError extends ArenaError {
  constructor(bracketSize: number) {
    super(`Slot index must be between 0 and ${bracketSize - 1}.`);
  }
}

export class DuplicateBookError extends ArenaError {
  constructor() {
    super("The same book can't fill two bracket slots.");
  }
}

export class DuelNotFoundError extends ArenaError {
  constructor() {
    super("No such duel.");
  }
}

export class DuelNotVotableError extends ArenaError {
  constructor() {
    super("This duel isn't open for voting right now.");
  }
}

export class InvalidBookError extends ArenaError {
  constructor() {
    super("That book isn't one of this duel's two books.");
  }
}

export class AlreadyVotedError extends ArenaError {
  constructor() {
    super("You've already voted on this duel.");
  }
}

export class DuelNotTiedError extends ArenaError {
  constructor() {
    super("This duel isn't waiting on a tie-break.");
  }
}
