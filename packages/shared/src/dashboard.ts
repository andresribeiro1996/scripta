import type { CommunityAuthor, FeedItem, ParticipationGameKind, PublishedContent, RankingTierPreview, SavedContentRef } from "./community/types.js";
import { contentTarget, feedAction, feedTarget, isKnownContent } from "./community/helpers.js";
import { bookKey } from "./library/merge.js";
import { rediscoverPassage } from "./murals/home.js";
import type { PublicMural } from "./public/types.js";

export interface DigestBook {
  title: string;
  author: string;
  coverUrl: string | null;
  workId?: string | null;
  isbn?: string | null;
}

export interface ParticipationGame {
  kind: ParticipationGameKind;
  id: string;
  name: string;
  covers: string[];
  voteCode?: string;
}

export type ParticipationItem = {
  kind: "participation";
  id: string;
  game: ParticipationGame;
  actors: CommunityAuthor[];
  count: number;
  createdAt: string;
};

export type CompletionItem = { kind: "completion"; id: string; actor: CommunityAuthor; tournament: Extract<PublishedContent, { kind: "tournament" }>; winner: DigestBook; createdAt: string };

export type DigestItem = (
  | ({ kind: "publication" } & FeedItem)
  | { kind: "vote"; id: string; actor: CommunityAuthor; content: PublishedContent; ranking?: RankingTierPreview[]; createdAt: string }
  | { kind: "reading"; id: string; actor: CommunityAuthor; book: DigestBook; finished: boolean; started?: boolean; createdAt: string }
  | { kind: "mural"; id: string; actor: CommunityAuthor; mural: Pick<PublicMural, "id" | "name" | "theme" | "coverImageUrl">; createdAt: string }
  // `viewerFollows` is what lets the row offer following back, and it is the
  // viewer's relationship to the actor, not the actor's to them.
  | { kind: "follow"; id: string; actor: CommunityAuthor; createdAt: string; viewerFollows: boolean }
  | ParticipationItem
  | CompletionItem
);

export function savedContentRef(item: DigestItem): SavedContentRef | null {
  if (item.kind === "publication" || item.kind === "vote") return { kind: item.content.kind, id: item.content.id };
  if (item.kind === "participation") return { kind: item.game.kind, id: item.game.id };
  if (item.kind === "completion") return { kind: "tournament", id: item.tournament.id };
  if (item.kind === "mural") return { kind: "mural", id: item.mural.id, ownerId: item.actor.userId };
  return null;
}

export type DigestKind = DigestItem["kind"];

export interface DashboardFeedPage {
  items: DigestItem[];
  nextCursor: string | null;
  seenAt: string | null;
  personalNewCount: number;
  followingNewCount: number;
}

const DIGEST_KINDS: Record<DigestKind, true> = { publication: true, vote: true, reading: true, follow: true, participation: true, mural: true, completion: true };

export function isKnownDigestItem(item: DigestItem): boolean {
  if (DIGEST_KINDS[item.kind as DigestKind] !== true) return false;
  if (item.kind === "publication" || item.kind === "vote") return isKnownContent(item.content);
  return true;
}

export function withKnownDigestItems(page: DashboardFeedPage): DashboardFeedPage {
  return { ...page, items: page.items.filter(isKnownDigestItem) };
}

export function dashboardQuery(cursor?: string): string {
  const query = `?kinds=${[...Object.keys(DIGEST_KINDS), "started"].join(",")}`;
  return cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query;
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

export function upNextPair(keys: string[], offset: number): string[] {
  const n = keys.length;
  if (n < 2) return [];
  const first = keys[offset % n];
  const second = keys[(offset + 1) % n];
  return first === second ? [first] : [first, second];
}

const PARTICIPATION_VERBS: Record<ParticipationGameKind, string> = {
  tierlist: "ranked your tier list",
  tournament: "voted in your tournament",
  quiz: "played your quiz"
};

export function participationLead(item: ParticipationItem): string {
  const names = item.actors.map((actor) => actor.username);
  const others = item.count - names.length;
  if (names.length === 0) return `${item.count} ${item.count === 1 ? "person" : "people"}`;
  if (others <= 0) return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.join(", ")} and ${others} ${others === 1 ? "other" : "others"}`;
}

export function isNewDigestItem(item: DigestItem, seenAt: string | null): boolean {
  return seenAt === null || item.createdAt > seenAt;
}

export function newCountLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export function clearDashboardCounts<T extends { pages: DashboardFeedPage[] }>(data: T): T {
  return { ...data, pages: data.pages.map((page) => ({ ...page, personalNewCount: 0, followingNewCount: 0 })) };
}

export function digestAction(item: DigestItem): string {
  switch (item.kind) {
    case "publication":
      return feedAction(item);
    case "vote":
      switch (item.content.kind) {
        case "tierlist":
          return `ranked books on ${item.content.name}`;
        case "tournament":
          return `voted in ${item.content.name}`;
        case "quiz":
          return `played ${item.content.name}`;
      }
    case "reading":
      return `${item.finished ? "finished reading" : item.started ? "started reading" : "added"} ${item.book.title}`;
    case "mural":
      return `published a mural, ${item.mural.name}`;
    case "completion":
      return `${item.tournament.name} finished; ${item.winner.title} is the winner`;
    case "follow":
      return "started following you";
    case "participation":
      return `${PARTICIPATION_VERBS[item.game.kind]} ${item.game.name}`;
  }
}

export function digestHeading(item: DigestItem): string {
  if (item.kind === "participation") return `${participationLead(item)} ${digestAction(item)}`;
  if (item.kind === "completion") return digestAction(item);
  return `${item.actor.username} ${digestAction(item)}`;
}

export function digestTarget(item: DigestItem): string {
  switch (item.kind) {
    case "publication":
      return feedTarget(item);
    case "vote":
      return contentTarget(item.content);
    case "reading":
      return item.book.workId ? `/work/${item.book.workId}` : `/community/u/${item.actor.username}`;
    case "follow":
      return `/community/u/${item.actor.username}`;
    case "participation":
      return item.game.kind === "tournament" ? `/arena/${item.game.id}` : `/dashboard/arena/${item.game.kind}/${item.game.id}`;
    case "mural":
      return `/community/u/${item.actor.username}`;
    case "completion":
      return `/arena/${item.tournament.id}`;
  }
}
