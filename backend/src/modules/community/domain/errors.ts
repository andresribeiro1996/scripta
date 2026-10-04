import { FOLLOW_LIMIT } from "./feed.js";

export class CommunityError extends Error {}

export class ProfileNotFoundError extends CommunityError {
  constructor() {
    super("No published profile at that address.");
  }
}

export class SelfFollowError extends CommunityError {
  constructor() {
    super("You can't follow yourself.");
  }
}

export class FollowLimitError extends CommunityError {
  constructor() {
    super(`You can follow up to ${FOLLOW_LIMIT.toLocaleString("en-US")} readers.`);
  }
}

export class NotFollowingError extends CommunityError {
  constructor() {
    super("You aren't following that profile.");
  }
}

export class UsernameRequiredError extends CommunityError {
  constructor() {
    super("Choose a username before publishing your profile.");
  }
}

export class MuralNotOwnedError extends CommunityError {
  constructor() {
    super("No mural of yours with that id.");
  }
}

export class InvalidCursorError extends CommunityError {
  constructor() {
    super("Invalid feed cursor.");
  }
}
