import type { ActivityEventType } from "@scripta/shared/community";
import type { DigestKind } from "@scripta/shared/dashboard";

export const DIGEST_EVENT_TYPES: ReadonlyArray<readonly [ActivityEventType, DigestKind]> = [
  ["tierlist_published", "publication"],
  ["tournament_published", "publication"],
  ["voted_on", "vote"],
  ["book_added", "reading"],
  ["book_finished", "reading"]
];

export const FEED_EVENT_TYPES: readonly ActivityEventType[] = DIGEST_EVENT_TYPES.map(([type]) => type);

export const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const FOLLOW_LIMIT = 1000;
