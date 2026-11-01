import type { Locale } from "@scripta/shared/i18n";
import { LocalizedError, t } from "../../../i18n/index.js";
import { FOLLOW_LIMIT } from "./feed.js";

export class CommunityError extends LocalizedError {}

export class ProfileNotFoundError extends CommunityError {
  constructor() {
    super("community.profileNotFound");
  }
}

export class SelfFollowError extends CommunityError {
  constructor() {
    super("community.selfFollow");
  }
}

export class FollowLimitError extends CommunityError {
  constructor() {
    super("community.followLimit", { limit: FOLLOW_LIMIT.toLocaleString("en-US") });
  }
}

export class NotFollowingError extends CommunityError {
  constructor() {
    super("community.notFollowing");
  }
}

export class UsernameRequiredError extends CommunityError {
  constructor() {
    super("community.usernameRequired");
  }
}

export class MuralNotOwnedError extends CommunityError {
  constructor() {
    super("community.muralNotOwned");
  }
}

export class InvalidCursorError extends CommunityError {
  constructor() {
    super("community.invalidCursor");
  }
}

export function communityErrorMessage(locale: Locale, error: CommunityError): string {
  const vars = error instanceof FollowLimitError ? { limit: FOLLOW_LIMIT.toLocaleString(locale === "en" ? "en-US" : locale) } : error.vars;
  return t(locale, error.key, vars);
}
