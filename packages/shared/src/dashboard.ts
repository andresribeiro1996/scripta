import type { CommunityAuthor, FeedItem, PublishedContent } from "./community/types.js";
import { contentTarget, feedHeading, feedTarget } from "./community/helpers.js";
import { bookKey } from "./library/merge.js";
import { rediscoverPassage } from "./murals/home.js";

export interface DigestBook {
  title: string;
  author: string;
  coverUrl: string | null;
}

export type DigestItem =
  | ({ kind: "publication" } & FeedItem)
  | { kind: "vote"; id: string; actor: CommunityAuthor; content: PublishedContent; createdAt: string }
  | { kind: "reading"; id: string; actor: CommunityAuthor; book: DigestBook; finished: boolean; createdAt: string }
  // `viewerFollows` is what lets the row offer following back, and it is the
  // viewer's relationship to the actor, not the actor's to them.
  | { kind: "follow"; id: string; actor: CommunityAuthor; createdAt: string; viewerFollows: boolean };

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
  switch (item.kind) {
    case "publication":
      return feedHeading(item);
    case "vote":
      return item.content.kind === "tierlist"
        ? `${item.actor.username} ranked books on ${item.content.name}`
        : `${item.actor.username} voted in ${item.content.name}`;
    case "reading":
      return `${item.actor.username} ${item.finished ? "finished" : "added"} ${item.book.title}`;
    case "follow":
      return `${item.actor.username} started following you`;
  }
}

// A book someone else read is not a page this reader can open — their
// profile is the nearest thing the tap can lead to.
export function digestTarget(item: DigestItem): string {
  switch (item.kind) {
    case "publication":
      return feedTarget(item);
    case "vote":
      return contentTarget(item.content);
    case "reading":
    case "follow":
      return `/community/u/${item.actor.username}`;
  }
}
