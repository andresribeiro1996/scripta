import { FAN_SIZE, TIER_LADDER } from "../community/communityHome";
import { itemNoun, quizPreview, tierlistBookCount, type QuizPreview } from "@scripta/shared";
import { contentStatusBadge, ownedTierlistStatus, type ContentTone } from "@scripta/shared/community";
import type { Quiz } from "../quizzes/api";
import type { Tierlist, VotedTierlist } from "../tierlists/api";
import type { Tournament } from "./api";
import type { Locale } from "@scripta/shared/i18n";
import { translatorFor, type MessageKey } from "../../i18n";

export const ARENA_TABS = [
  { value: "tournaments", labelKey: "book.tournaments" },
  { value: "tierlists", labelKey: "book.tierLists" },
  { value: "quizzes", labelKey: "community.filterQuizzes" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

export type ArenaTab = (typeof ARENA_TABS)[number]["value"];

export const GAMES_TABS = [{ value: "browse", labelKey: "arena.tabBrowse" }, ...ARENA_TABS] as const;

export type GamesTab = (typeof GAMES_TABS)[number]["value"];

export const NEW_GAMES = [
  { tab: "tournaments", labelKey: "book.gameTournament", href: "/seed/new" },
  { tab: "tierlists", labelKey: "book.gameTierlist", href: "/tierlist/new" },
  { tab: "quizzes", labelKey: "community.kindQuiz", href: "/quiz/new" },
] as const satisfies ReadonlyArray<{ tab: ArenaTab; labelKey: MessageKey; href: string }>;

export type OwnedItem =
  | { id: string; name: string; kind: "tournament"; source: Tournament }
  | { id: string; name: string; detail: string; kind: "tierlist"; source: Tierlist }
  | { id: string; name: string; detail: string; kind: "quiz"; source: Quiz };

/** One FlatList row: either a plain-text section header, one of the
 *  account's own items, or content from someone else the account voted
 *  in. Voted rows carry their push target and never a delete action. */
export type SectionedItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "owned"; key: string; item: OwnedItem }
  | { kind: "votedTournament"; key: string; target: string; tournament: Tournament }
  | { kind: "votedTierlist"; key: string; target: string; tierlist: VotedTierlist };

export const DELETE_EFFECT = {
  tournament: "arena.deleteEffectTournament",
  tierlist: "arena.deleteEffectTierlist",
  quiz: "arena.deleteEffectQuiz",
} as const satisfies Record<OwnedItem["kind"], MessageKey>;

type Badge = { label: string; tone: ContentTone };

function tournamentBadge(status: Tournament["status"], locale: Locale): Badge {
  if (status === "seeding") return { label: translatorFor(locale)("arena.seeding"), tone: "neutral" };
  return contentStatusBadge(status === "active" ? "inProgress" : "completed", locale);
}

type Stage = "draft" | "open" | "closed";

const TIERLIST_STATUS = { draft: "draft", open: "votingOpen", closed: "closed" } as const;

const QUIZ_STATUS = { draft: "draft", open: "open", closed: "closed" } as const;

function stage(voteCode: string | null, open: boolean): Stage {
  return !voteCode ? "draft" : open ? "open" : "closed";
}

export function tabIndex(tab: ArenaTab): number {
  return Math.max(0, ARENA_TABS.findIndex((option) => option.value === tab));
}

export function tabAtIndex(index: number): ArenaTab {
  return ARENA_TABS[Math.min(ARENA_TABS.length - 1, Math.max(0, index))]!.value;
}

export function ownedItems(tab: ArenaTab, tournaments: Tournament[], tierlists: Tierlist[], locale: Locale, quizzes: Quiz[] = []): OwnedItem[] {
  const t = translatorFor(locale);
  if (tab === "tournaments") {
    return tournaments.map((source) => ({
      id: source.id,
      name: source.name,
      kind: "tournament",
      source,
    }));
  }
  if (tab === "quizzes") {
    return quizzes.map((source) => {
      return {
        id: source.id,
        name: source.name,
        detail: t("library.bookCount", { count: source.data.books.length }),
        kind: "quiz",
        source,
      };
    });
  }
  return tierlists.map((source) => {
    const tiers = source.data.tiers.length;
    const books = tierlistBookCount(source.data);
    return {
      id: source.id,
      name: source.name,
      detail: t("arena.tierlistDetail", { books, noun: itemNoun(source.subject, books, locale), tiers: t("arena.tierCount", { count: tiers }) }),
      kind: "tierlist",
      source,
    };
  });
}

export const OWNER_FILTERS = [
  { value: "all", labelKey: "arena.filterAll" },
  { value: "mine", labelKey: "arena.createdByYou" },
  { value: "voted", labelKey: "arena.votedOn" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

export type OwnerFilter = (typeof OWNER_FILTERS)[number]["value"];

export function nextOwnerFilter(filter: OwnerFilter): OwnerFilter {
  const index = OWNER_FILTERS.findIndex((option) => option.value === filter);
  return OWNER_FILTERS[(index + 1) % OWNER_FILTERS.length]!.value;
}

function section(key: string, title: string, rows: SectionedItem[], locale: Locale): SectionedItem[] {
  return rows.length ? [{ kind: "header", key, title: translatorFor(locale)("arena.sectionHeader", { title, count: rows.length }) }, ...rows] : [];
}

/** A section's heading shows whenever it has rows and counts the rows left
 *  after the ownership filter and search, so a section the needle or filter
 *  emptied loses its heading rather than leaving an orphaned title. */
export function homeSections(
  tab: ArenaTab,
  owned: OwnedItem[],
  votedTournaments: Tournament[],
  votedTierlists: VotedTierlist[],
  locale: Locale,
  owner: OwnerFilter = "all",
  search = ""
): SectionedItem[] {
  const t = translatorFor(locale);
  const needle = search.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const mine: SectionedItem[] =
    owner === "voted" ? [] : owned.filter((item) => matches(item.name)).map((item) => ({ kind: "owned", key: item.id, item }));
  const created = t("arena.createdByYou");
  if (tab === "quizzes" || owner === "mine") return section("created", created, mine, locale);

  const votedRows: SectionedItem[] =
    tab === "tournaments"
      ? votedTournaments
          .filter((tournament) => matches(tournament.name))
          .map((tournament) => ({ kind: "votedTournament", key: `voted:${tournament.id}`, target: `/arena/${tournament.id}`, tournament }))
      : votedTierlists
          .filter((tierlist) => matches(tierlist.name))
          .map((tierlist) => ({ kind: "votedTierlist", key: `voted:${tierlist.id}`, target: `/vote/${tierlist.voteCode}`, tierlist }));
  return [...section("created", created, mine, locale), ...section("participating", t(tab === "tournaments" ? "arena.votingIn" : "arena.votedOn"), votedRows, locale)];
}

export function emptyCopy(tab: ArenaTab, searching: boolean, locale: Locale, owner: OwnerFilter = "all"): { title: string; body: string; action?: string } {
  const t = translatorFor(locale);
  if (searching) return { title: t("arena.nothingMatches"), body: t("arena.tryDifferentSearch") };
  if (owner === "voted") {
    return tab === "tournaments"
      ? { title: t("arena.votedNoneTournamentsTitle"), body: t("arena.votedNoneTournamentsBody") }
      : { title: t("arena.votedNoneTierlistsTitle"), body: t("arena.votedNoneTierlistsBody") };
  }
  if (tab === "quizzes") return { title: t("arena.noQuizzesTitle"), body: t("arena.noQuizzesBody"), action: t("arena.createQuiz") };
  return tab === "tournaments"
    ? { title: t("arena.noTournamentsTitle"), body: t("arena.noTournamentsBody"), action: t("book.createTournament") }
    : { title: t("arena.noTierlistsTitle"), body: t("arena.noTierlistsBody"), action: t("book.createTierlist") };
}

export function tournamentProgress(tournament: Tournament, locale: Locale): {
  label: string;
  totalRounds: number;
  completedRounds: number;
} {
  // A bracket halves every round, so its depth is log2 of its size.
  const totalRounds = Math.max(1, Math.round(Math.log2(tournament.bracketSize)));
  const t = translatorFor(locale);
  if (tournament.status === "seeding") {
    return { label: t("arena.slotsFilled", { filled: tournament.filledSlots, size: tournament.bracketSize }), totalRounds, completedRounds: 0 };
  }
  if (tournament.status === "completed") {
    return { label: "", totalRounds, completedRounds: totalRounds };
  }
  const round = Math.min(totalRounds, Math.max(1, tournament.currentRound));
  return { label: t("arena.roundOf", { round, total: totalRounds }), totalRounds, completedRounds: round - 1 };
}

export function tierlistCovers(data: Tierlist["data"], byWork: Map<string, Record<string, unknown>>): Array<Record<string, unknown>> {
  const books = new Set<Record<string, unknown>>();
  for (const workId of [...data.tiers.flatMap((tier) => tier.workIds), ...data.pool]) {
    const book = byWork.get(workId);
    if (book) books.add(book);
    if (books.size === FAN_SIZE) break;
  }
  return [...books];
}

export function tierlistRowCovers(tierlist: Tierlist, byWork: Map<string, Record<string, unknown>>): Array<string | Record<string, unknown>> {
  if (tierlist.subject) return tierlist.subject.scope.coverUrl ? [tierlist.subject.scope.coverUrl] : [];
  return tierlistCovers(tierlist.data, byWork);
}

export function votedTierlistDetail(tierlist: VotedTierlist, locale: Locale): string {
  const t = translatorFor(locale);
  return t("arena.votedTierlistDetail", { pool: tierlist.poolSize, noun: itemNoun(tierlist.subject, tierlist.poolSize, locale), ballots: t("arena.ballotCount", { count: tierlist.ballotCount }) });
}

export type GameRowModel = {
  kind: OwnedItem["kind"];
  name: string;
  meta: string;
  badges: Badge[];
  caption?: string;
  covers: string[];
  ladder?: string[];
  preview?: QuizPreview;
};

function tournamentRow(tournament: Tournament, locale: Locale): GameRowModel {
  return {
    kind: "tournament",
    name: tournament.name,
    meta: translatorFor(locale)(tournament.subject ? "arena.bracketMetaCharacters" : "arena.bracketMetaBooks", { size: tournament.bracketSize }),
    badges: [tournamentBadge(tournament.status, locale)],
    caption: tournamentProgress(tournament, locale).label,
    covers: tournament.covers,
  };
}

export function gameRow(row: Exclude<SectionedItem, { kind: "header" }>, locale: Locale): GameRowModel {
  if (row.kind === "votedTournament") {
    const model = tournamentRow(row.tournament, locale);
    return { ...model, badges: [...model.badges, contentStatusBadge("voted", locale)] };
  }
  if (row.kind === "votedTierlist") {
    const { tierlist } = row;
    return {
      kind: "tierlist",
      name: tierlist.name,
      meta: votedTierlistDetail(tierlist, locale),
      badges: [contentStatusBadge(TIERLIST_STATUS[tierlist.votingOpen ? "open" : "closed"], locale), contentStatusBadge("voted", locale)],
      covers: tierlist.covers,
      ladder: TIER_LADDER,
    };
  }
  const { item } = row;
  if (item.kind === "tournament") return tournamentRow(item.source, locale);
  if (item.kind === "quiz") {
    return {
      kind: "quiz",
      name: item.name,
      meta: item.detail,
      badges: [contentStatusBadge(QUIZ_STATUS[stage(item.source.voteCode, item.source.playOpen)], locale)],
      covers: item.source.data.books.flatMap((book) => (book.coverUrl ? [book.coverUrl] : [])),
      preview: quizPreview(item.source.data),
    };
  }
  return {
    kind: "tierlist",
    name: item.name,
    meta: item.detail,
    badges: [ownedTierlistStatus(item.source, locale)],
    covers: [],
    ladder: item.source.data.tiers.map((tier) => tier.color),
  };
}
