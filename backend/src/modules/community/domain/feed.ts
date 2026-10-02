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

const EVERY_ACTIVITY_EVENT_TYPE = {
  tierlist_published: true,
  tournament_published: true,
  book_added: true,
  book_finished: true,
  following: true,
  mural_published: true,
  voted_on: true
} satisfies Record<ActivityEventType, true>;

export const ACTIVITY_EVENT_TYPES = Object.keys(EVERY_ACTIVITY_EVENT_TYPE) as readonly ActivityEventType[];

export const FEED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const ARCHIVE_BATCH = 250;

export const FOLLOW_LIMIT = 1000;

export const FOLLOW_COPY_LIMIT = 100;
