import { bracketShape, needsVote, type Duel, type DuelSide } from "@scripta/shared";
import type { TournamentView } from "./api";

const ALL_ARENA_VIEW_TABS = [
  { value: "bracket", label: "Bracket" },
  { value: "match", label: "Match" },
] as const;

export type ArenaViewTab = (typeof ALL_ARENA_VIEW_TABS)[number]["value"];

/** Both tabs, always: a finished tournament keeps Match because that is
 *  where its winner is shown, and a pane that disappears on the last vote
 *  would take the result with it. */
export function arenaViewTabs(_status: TournamentView["status"]): Array<{ value: ArenaViewTab; label: string }> {
  return [...ALL_ARENA_VIEW_TABS];
}

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

/** The book that won the final, read off that duel rather than the
 *  summary's own `winner` field — that one has been seen already set while
 *  earlier rounds were still open. */
export function tournamentChampion(bracketSize: number, duels: Duel[]): DuelSide | null {
  const lastRound = bracketShape(bracketSize, duels).at(-1);
  const final = lastRound?.length === 1 ? lastRound[0] : null;
  if (!final?.winnerKey) return null;
  return final.winnerKey === final.bookA.key ? final.bookA : final.bookB;
}

export function matchEmptyCopy(status: TournamentView["status"], hasDuels: boolean): { title: string; body: string } {
  if (status === "seeding") return { title: "Not started yet", body: "The first matches open once every slot is seeded." };
  if (status === "completed") return { title: "No matches", body: "Every match has been played." };
  if (!hasDuels) return { title: "No matches yet", body: "Pull to refresh for updates." };
  return { title: "All caught up", body: "Every open match already has your vote. The next round opens when this one closes." };
}
