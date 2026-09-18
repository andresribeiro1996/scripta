import type { TierDefinition } from "@scripta/shared";
import type { Tierlist, VotedTierlist } from "../tierlists/api";
import type { TournamentSummary } from "./api";

export const ARENA_TABS = [
  { value: "tournaments", label: "Tournaments" },
  { value: "tierlists", label: "Tier lists" },
] as const;

export type ArenaTab = (typeof ARENA_TABS)[number]["value"];

// A tournament card draws its own status pill and progress line from the
// summary, so it has no caption string; a tier list's caption is a plain
// count and stays one.
export type OwnedItem =
  | { id: string; name: string; kind: "tournament"; source: TournamentSummary }
  | { id: string; name: string; detail: string; kind: "tierlist"; source: Tierlist };

/** One FlatList row: either a plain-text section header, one of the
 *  account's own items, or content from someone else the account voted
 *  in. Voted rows carry their push target and never a delete action. */
export type SectionedItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "owned"; key: string; item: OwnedItem }
  | { kind: "votedTournament"; key: string; target: string; tournament: TournamentSummary }
  | { kind: "votedTierlist"; key: string; target: string; tierlist: VotedTierlist };

export const CREATED_BY_YOU = "Created by you";

export function tabIndex(tab: ArenaTab): number {
  return Math.max(0, ARENA_TABS.findIndex((option) => option.value === tab));
}

export function tabAtIndex(index: number): ArenaTab {
  return ARENA_TABS[Math.min(ARENA_TABS.length - 1, Math.max(0, index))]!.value;
}

export function ownedItems(tab: ArenaTab, tournaments: TournamentSummary[], tierlists: Tierlist[]): OwnedItem[] {
  if (tab === "tournaments") {
    return tournaments.map((source) => ({
      id: source.id,
      name: source.name,
      kind: "tournament",
      source,
    }));
  }
  return tierlists.map((source) => {
    const tiers = source.data.tiers.length;
    const books = source.data.tiers.reduce((total, tier) => total + tier.bookKeys.length, 0);
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

export function filterItems(items: OwnedItem[], search: string): OwnedItem[] {
  const needle = search.trim().toLowerCase();
  return needle ? items.filter((item) => item.name.toLowerCase().includes(needle)) : items;
}

/** With no participation the tab stays the flat owned list it always was;
 *  section headers only appear around a non-empty voted section. */
export function homeSections(
  tab: ArenaTab,
  owned: OwnedItem[],
  votedTournaments: TournamentSummary[],
  votedTierlists: VotedTierlist[]
): SectionedItem[] {
  const voted = tab === "tournaments" ? votedTournaments : votedTierlists;
  if (voted.length === 0) return owned.map((item) => ({ kind: "owned", key: item.id, item }));

  const sectionTitle = tab === "tournaments" ? "Voting in" : "Voted on";
  const votedRows: SectionedItem[] =
    tab === "tournaments"
      ? votedTournaments.map((tournament) => ({
          kind: "votedTournament" as const,
          key: `voted:${tournament.id}`,
          target: `/arena/${tournament.id}`,
          tournament,
        }))
      : votedTierlists.map((tierlist) => ({
          kind: "votedTierlist" as const,
          key: `voted:${tierlist.id}`,
          target: `/vote/${tierlist.voteCode}`,
          tierlist,
        }));
  return [
    { kind: "header", key: "created", title: CREATED_BY_YOU },
    ...owned.map((item) => ({ kind: "owned" as const, key: item.id, item })),
    { kind: "header", key: "participating", title: sectionTitle },
    ...votedRows,
  ];
}

function sectionItemName(item: SectionedItem): string | null {
  if (item.kind === "header") return null;
  if (item.kind === "owned") return item.item.name;
  if (item.kind === "votedTournament") return item.tournament.name;
  return item.tierlist.name;
}

/** Active search collapses to a flat hit list — headers would leave
 *  orphaned titles above sections the needle emptied. */
export function filterSections(sections: SectionedItem[], search: string): SectionedItem[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return sections;
  return sections.filter((item) => {
    const name = sectionItemName(item);
    return name !== null && name.toLowerCase().includes(needle);
  });
}

export function emptyCopy(tab: ArenaTab, searching: boolean): { title: string; body: string } {
  if (searching) return { title: "Nothing matches", body: "Try a different search." };
  return tab === "tournaments"
    ? { title: "No tournaments yet", body: "Create one and seed it from your library." }
    : { title: "No tier lists yet", body: "Create one to rank books into tiers." };
}

export type TierSegment = { color: string; weight: number };

/** Segment widths in proportion to how many books sit in each tier. A list
 *  nobody has sorted yet would otherwise collapse to nothing, so an empty
 *  ladder draws even segments — the palette still reads, the proportions
 *  just aren't claiming anything. */
export function tierDistribution(tiers: TierDefinition[]): TierSegment[] {
  const sorted = tiers.reduce((total, tier) => total + tier.bookKeys.length, 0);
  return tiers.map((tier) => ({ color: tier.color, weight: sorted === 0 ? 1 : tier.bookKeys.length }));
}

export function tournamentProgress(tournament: TournamentSummary): {
  label: string;
  totalRounds: number;
  completedRounds: number;
} {
  // A bracket halves every round, so its depth is log2 of its size.
  const totalRounds = Math.max(1, Math.round(Math.log2(tournament.bracketSize)));
  if (tournament.status === "seeding") {
    return { label: `${tournament.filledSlots} of ${tournament.bracketSize} slots filled`, totalRounds, completedRounds: 0 };
  }
  if (tournament.status === "completed") {
    return { label: "Winner decided", totalRounds, completedRounds: totalRounds };
  }
  const round = Math.min(totalRounds, Math.max(1, tournament.currentRound));
  return { label: `Round ${round} of ${totalRounds}`, totalRounds, completedRounds: round - 1 };
}

/** Seeded books beyond the four thumbnails the card shows. Slots seeded
 *  without art are counted but never previewed, so this can't be derived
 *  from the bracket size. */
export function coverRemainder(tournament: TournamentSummary): number {
  return Math.max(0, tournament.filledSlots - tournament.covers.length);
}

/** Card caption for someone else's poll the account voted on — same
 *  format the public directory uses. */
export function votedTierlistDetail(tierlist: VotedTierlist): string {
  return `${tierlist.poolSize} books · ${tierlist.ballotCount} ballots${tierlist.votingOpen ? "" : " · closed"}`;
}
