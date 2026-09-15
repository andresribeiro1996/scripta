import type { TierDefinition } from "@scripta/shared";
import type { Tierlist } from "../tierlists/api";
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
