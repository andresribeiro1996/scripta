import { bracketShape, needsVote, type Duel } from "@scripta/shared";
import type { TournamentView } from "./api";

export const ARENA_VIEW_TABS = [
  { value: "match", label: "Match" },
  { value: "bracket", label: "Bracket" },
] as const;

export type ArenaViewTab = (typeof ARENA_VIEW_TABS)[number]["value"];

export function votableDuels(duels: Duel[]): Duel[] {
  return duels.filter(needsVote);
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
