import { sharedT } from "./i18n/sharedT.js";
import type { Locale } from "./i18n/locale.js";
import type { CommunityAuthor, FeedItem, ParticipationGameKind, PublishedContent, RankingTierPreview, SavedContentRef } from "./community/types.js";
import { contentTarget, feedAction, feedTarget, isKnownContent } from "./community/helpers.js";
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

const ALL_DIGEST_KINDS: readonly string[] = [...Object.keys(DIGEST_KINDS), "started"];
export const CIRCLE_DIGEST_KINDS = ["publication", "vote", "reading", "mural", "started"] as const;
export const PERSONAL_DIGEST_KINDS = ["follow", "participation", "completion"] as const satisfies readonly DigestKind[];

export function dashboardQuery(cursor?: string, kinds: readonly string[] = ALL_DIGEST_KINDS): string {
  const query = `?kinds=${kinds.join(",")}`;
  return cursor ? `${query}&cursor=${encodeURIComponent(cursor)}` : query;
}

const PARTICIPATION_VERBS = {
  tierlist: "shared.dashboard.verbTierlist",
  tournament: "shared.dashboard.verbTournament",
  quiz: "shared.dashboard.verbQuiz"
} as const satisfies Record<ParticipationGameKind, Parameters<ReturnType<typeof sharedT>>[0]>;

export function participationVerb(item: ParticipationItem, locale: Locale): string {
  return sharedT(locale)(PARTICIPATION_VERBS[item.game.kind], { count: item.count });
}

export function participationLead(item: ParticipationItem, locale: Locale): string {
  const t = sharedT(locale);
  const names = item.actors.map((actor) => actor.username);
  const others = item.count - names.length;
  if (names.length === 0) return t("shared.dashboard.people", { count: item.count });
  if (others <= 0) return names.length === 1 ? names[0]! : t("shared.dashboard.namesAnd", { names: names.slice(0, -1).join(", "), last: names[names.length - 1]! });
  return t("shared.dashboard.namesAndOthers", { names: names.join(", "), count: others });
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

export function digestAction(item: DigestItem, locale: Locale): string {
  const t = sharedT(locale);
  switch (item.kind) {
    case "publication":
      return feedAction(item, locale);
    case "vote":
      switch (item.content.kind) {
        case "tierlist":
          return t("shared.dashboard.rankedBooksOn", { name: item.content.name });
        case "tournament":
          return t("shared.dashboard.votedIn", { name: item.content.name });
        case "quiz":
          return t("shared.dashboard.played", { name: item.content.name });
      }
    case "reading":
      return t(item.finished ? "shared.dashboard.finishedReading" : item.started ? "shared.dashboard.startedReading" : "shared.dashboard.added", { title: item.book.title });
    case "mural":
      return t("shared.dashboard.publishedMural", { name: item.mural.name });
    case "completion":
      return t("shared.dashboard.completion", { tournament: item.tournament.name, winner: item.winner.title });
    case "follow":
      return t("shared.dashboard.startedFollowing");
    case "participation":
      return `${participationVerb(item, locale)} ${item.game.name}`;
  }
}

export function digestHeading(item: DigestItem, locale: Locale): string {
  if (item.kind === "participation") return `${participationLead(item, locale)} ${digestAction(item, locale)}`;
  if (item.kind === "completion") return digestAction(item, locale);
  return `${item.actor.username} ${digestAction(item, locale)}`;
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
