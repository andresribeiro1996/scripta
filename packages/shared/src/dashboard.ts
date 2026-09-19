import type { CommunityAuthor, FeedItem } from "./community/types.js";
import { feedHeading, feedTarget } from "./community/helpers.js";
import { bookKey } from "./library/merge.js";
import { rediscoverPassage } from "./murals/home.js";

export type DigestItem =
  | ({ kind: "publication" } & FeedItem)
  | { kind: "follow"; id: string; actor: CommunityAuthor; createdAt: string };

export interface DashboardFeedPage {
  items: DigestItem[];
  nextCursor: string | null;
  newCount: number;
}

export type DashboardCard =
  | { kind: "currentlyReading"; bookKeys: string[] }
  | { kind: "upNext"; bookKeys: string[] }
  | { kind: "rediscover"; bookKey: string; highlightId: string };

export function buildDashboardCards(books: Array<Record<string, unknown>>, day: string, salt = "dashboard"): DashboardCard[] {
  const cards: DashboardCard[] = [];
  const reading = books.filter((book) => book.ReadStatus === 1).map(bookKey);
  if (reading.length) cards.push({ kind: "currentlyReading", bookKeys: reading });
  const upNext = books.filter((book) => book.ReadStatus !== 1 && book.ReadStatus !== 2).map(bookKey);
  if (upNext.length) cards.push({ kind: "upNext", bookKeys: upNext });
  const passage = rediscoverPassage(salt, books, day);
  if (passage) cards.push({ kind: "rediscover", bookKey: passage.bookKey, highlightId: passage.highlightId });
  return cards;
}

export function digestHeading(item: DigestItem): string {
  return item.kind === "follow" ? `${item.actor.username} started following you` : feedHeading(item);
}

export function digestTarget(item: DigestItem): string {
  return item.kind === "follow" ? `/community/u/${item.actor.username}` : feedTarget(item);
}
