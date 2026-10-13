import type { TierDefinition } from "@scripta/shared";
import type { Quiz } from "../quizzes/api";
import type { Tierlist, VotedTierlist } from "../tierlists/api";
import type { Tournament } from "./api";

export const ARENA_TABS = [
  { value: "tournaments", label: "Tournaments" },
  { value: "tierlists", label: "Tier lists" },
  { value: "quizzes", label: "Quizzes" },
] as const;

export type ArenaTab = (typeof ARENA_TABS)[number]["value"];

export const GAMES_TABS = [{ value: "browse", label: "Browse" }, ...ARENA_TABS] as const;

export type GamesTab = (typeof GAMES_TABS)[number]["value"];

export const NEW_GAMES = [
  { tab: "tournaments", label: "Tournament", href: "/seed/new" },
  { tab: "tierlists", label: "Tier list", href: "/tierlist/new" },
  { tab: "quizzes", label: "Quiz", href: "/quiz/new" },
] as const satisfies ReadonlyArray<{ tab: ArenaTab; label: string; href: string }>;

// A tournament card draws its own status pill and progress line from the
// summary, so it has no caption string; a tier list's caption is a plain
// count and stays one.
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

export const CREATED_BY_YOU = "Created by you";

export const DELETE_EFFECT: Record<OwnedItem["kind"], string> = {
  tournament: "Its matches and every vote on them are deleted, and its link stops working.",
  tierlist: "Its ballots are deleted, and its voting link stops working.",
  quiz: "Its plays and leaderboard are deleted, and its link stops working.",
};

export const TOURNAMENT_STATUS_LABEL: Record<Tournament["status"], string> = {
  seeding: "Seeding",
  active: "Active",
  completed: "Completed",
};

export function tabIndex(tab: ArenaTab): number {
  return Math.max(0, ARENA_TABS.findIndex((option) => option.value === tab));
}

export function tabAtIndex(index: number): ArenaTab {
  return ARENA_TABS[Math.min(ARENA_TABS.length - 1, Math.max(0, index))]!.value;
}

export function ownedItems(tab: ArenaTab, tournaments: Tournament[], tierlists: Tierlist[], quizzes: Quiz[] = []): OwnedItem[] {
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
      const status = source.voteCode === null ? "draft" : source.playOpen ? "open" : "closed";
      return {
        id: source.id,
        name: source.name,
        detail: `${source.data.books.length} ${source.data.books.length === 1 ? "book" : "books"} · ${status}`,
        kind: "quiz",
        source,
      };
    });
  }
  return tierlists.map((source) => {
    const tiers = source.data.tiers.length;
    const books = source.data.tiers.reduce((total, tier) => total + tier.workIds.length, source.data.pool.length);
    const voting = source.voteCode ? ` · voting ${source.votingOpen ? "open" : "closed"}` : "";
    return {
      id: source.id,
      name: source.name,
      detail: `${books} ${books === 1 ? "book" : "books"} · ${tiers} ${tiers === 1 ? "tier" : "tiers"}${voting}`,
      kind: "tierlist",
      source,
    };
  });
}

export const OWNER_FILTERS = [
  { value: "all", label: "All" },
  { value: "mine", label: "Created by you" },
  { value: "voted", label: "Voted on" },
] as const;

export type OwnerFilter = (typeof OWNER_FILTERS)[number]["value"];

export function nextOwnerFilter(filter: OwnerFilter): OwnerFilter {
  const index = OWNER_FILTERS.findIndex((option) => option.value === filter);
  return OWNER_FILTERS[(index + 1) % OWNER_FILTERS.length]!.value;
}

function section(key: string, title: string, rows: SectionedItem[]): SectionedItem[] {
  return rows.length ? [{ kind: "header", key, title: `${title} · ${rows.length}` }, ...rows] : [];
}

/** A section's heading shows whenever it has rows and counts the rows left
 *  after the ownership filter and search, so a section the needle or filter
 *  emptied loses its heading rather than leaving an orphaned title. */
export function homeSections(
  tab: ArenaTab,
  owned: OwnedItem[],
  votedTournaments: Tournament[],
  votedTierlists: VotedTierlist[],
  owner: OwnerFilter = "all",
  search = ""
): SectionedItem[] {
  const needle = search.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const mine: SectionedItem[] =
    owner === "voted" ? [] : owned.filter((item) => matches(item.name)).map((item) => ({ kind: "owned", key: item.id, item }));
  if (tab === "quizzes" || owner === "mine") return section("created", CREATED_BY_YOU, mine);

  const votedRows: SectionedItem[] =
    tab === "tournaments"
      ? votedTournaments
          .filter((tournament) => matches(tournament.name))
          .map((tournament) => ({ kind: "votedTournament", key: `voted:${tournament.id}`, target: `/arena/${tournament.id}`, tournament }))
      : votedTierlists
          .filter((tierlist) => matches(tierlist.name))
          .map((tierlist) => ({ kind: "votedTierlist", key: `voted:${tierlist.id}`, target: `/vote/${tierlist.voteCode}`, tierlist }));
  return [...section("created", CREATED_BY_YOU, mine), ...section("participating", tab === "tournaments" ? "Voting in" : "Voted on", votedRows)];
}

export function emptyCopy(tab: ArenaTab, searching: boolean, owner: OwnerFilter = "all"): { title: string; body: string; action?: string } {
  if (searching) return { title: "Nothing matches", body: "Try a different search." };
  if (owner === "voted") {
    const noun = tab === "tournaments" ? "tournaments" : "tier lists";
    return { title: `You haven't voted in any ${noun} yet`, body: `${noun[0]!.toUpperCase()}${noun.slice(1)} you vote in will show up here.` };
  }
  if (tab === "quizzes") return { title: "No quizzes yet", body: "Create one and turn your books into trivia.", action: "Create quiz" };
  return tab === "tournaments"
    ? { title: "No tournaments yet", body: "Create one and seed it from your library.", action: "Create tournament" }
    : { title: "No tier lists yet", body: "Create one to rank books into tiers.", action: "Create tier list" };
}

export type TierSegment = { color: string; weight: number };

/** Segment widths in proportion to how many books sit in each tier. A list
 *  nobody has sorted yet would otherwise collapse to nothing, so an empty
 *  ladder draws even segments — the palette still reads, the proportions
 *  just aren't claiming anything. */
export function tierDistribution(tiers: TierDefinition[]): TierSegment[] {
  const sorted = tiers.reduce((total, tier) => total + tier.workIds.length, 0);
  return tiers.map((tier) => ({ color: tier.color, weight: sorted === 0 ? 1 : tier.workIds.length }));
}

export function tournamentProgress(tournament: Tournament): {
  label: string;
  totalRounds: number;
  completedRounds: number;
} {
  // A bracket halves every round, so its depth is log2 of its size.
  const totalRounds = Math.max(1, Math.round(Math.log2(tournament.bracketSize)));
  if (tournament.status === "seeding") {
    return { label: `${tournament.filledSlots} of ${tournament.bracketSize} slots filled`, totalRounds, completedRounds: 0 };
  }
  // No caption: the COMPLETED pill beside it already says this, and the
  // champion is on the card as its own cover.
  if (tournament.status === "completed") {
    return { label: "", totalRounds, completedRounds: totalRounds };
  }
  const round = Math.min(totalRounds, Math.max(1, tournament.currentRound));
  return { label: `Round ${round} of ${totalRounds}`, totalRounds, completedRounds: round - 1 };
}

/** The thumbnail stack under the name. A finished tournament draws its
 *  champion as the card's own cover, so keeping it in the stack too spends
 *  a slot on a book already shown. */
export function previewCovers(tournament: Tournament): string[] {
  const champion = tournament.winner?.cover;
  return champion ? tournament.covers.filter((cover) => cover !== champion) : tournament.covers;
}

/** Seeded books beyond what the card shows — the stack plus the winner
 *  cover, which is one of them. Slots seeded without art are counted but
 *  never previewed, so this can't be derived from the bracket size. */
export function coverRemainder(tournament: Tournament): number {
  const shown = previewCovers(tournament).length + (tournament.winner ? 1 : 0);
  return Math.max(0, tournament.filledSlots - shown);
}

/** Card caption for someone else's poll the account voted on — same
 *  format the public directory uses. */
export function votedTierlistDetail(tierlist: VotedTierlist): string {
  return `${tierlist.poolSize} books · ${tierlist.ballotCount} ballots${tierlist.votingOpen ? "" : " · closed"}`;
}
