import { bracketShape, needsVote, type Duel } from "@scripta/shared";
import type { TournamentView } from "./api";

const ALL_ARENA_VIEW_TABS = [
  { value: "match", label: "Match" },
  { value: "books", label: "Books" },
  { value: "bracket", label: "Bracket" },
] as const;

export type ArenaViewTab = (typeof ALL_ARENA_VIEW_TABS)[number]["value"];

/** A finished tournament has nothing left to vote on, so Match — the pane
 *  built entirely around casting the next vote — drops out, leaving Books
 *  and the final Bracket. */
export function arenaViewTabs(status: TournamentView["status"]): Array<{ value: ArenaViewTab; label: string }> {
  return status === "completed" ? ALL_ARENA_VIEW_TABS.filter((tab) => tab.value !== "match") : [...ALL_ARENA_VIEW_TABS];
}

export function votableDuels(duels: Duel[]): Duel[] {
  return duels.filter(needsVote);
}

export function waitingLabel(count: number): string {
  return `${count} ${count === 1 ? "match" : "matches"} waiting on your vote`;
}

/** Every bracket position in round order, including the ones a later round
 *  hasn't filled yet — those keep a key so the list doesn't reshuffle when a
 *  winner finally lands in one. */
export function bracketSlots(bracketSize: number, duels: Duel[]): Array<{ key: string; duel: Duel | null }> {
  return bracketShape(bracketSize, duels).flatMap((round, roundIndex) =>
    round.map((duel, duelIndex) => ({ duel, key: `${roundIndex}:${duelIndex}` })));
}

export function matchEmptyCopy(status: TournamentView["status"], hasDuels: boolean): { title: string; body: string } {
  if (status === "seeding") return { title: "Not started yet", body: "The first matches open once every slot is seeded." };
  if (status === "completed") return { title: "Tournament over", body: "The bracket has the final result." };
  if (!hasDuels) return { title: "No matches yet", body: "Pull to refresh for updates." };
  return { title: "All caught up", body: "Every open match already has your vote. The next round opens when this one closes." };
}
