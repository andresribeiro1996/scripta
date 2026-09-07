import type { Duel } from "./types.js";

export type BracketSlot = Duel | null;

export function bracketShape(bracketSize: number, duels: Duel[]): BracketSlot[][] {
  const totalRounds = Math.log2(bracketSize);
  if (!Number.isInteger(totalRounds) || totalRounds < 1) {
    return [...new Set(duels.map((d) => d.roundNumber))]
      .sort((a, b) => a - b)
      .map((n) => duels.filter((d) => d.roundNumber === n).sort((a, b) => a.duelIndex - b.duelIndex));
  }

  const byPosition = new Map(duels.map((d) => [`${d.roundNumber}:${d.duelIndex}`, d]));
  return Array.from({ length: totalRounds }, (_, r) => {
    const roundNumber = r + 1;
    const count = bracketSize / 2 ** roundNumber;
    return Array.from({ length: count }, (_, i) => byPosition.get(`${roundNumber}:${i}`) ?? null);
  });
}

export function needsVote(duel: Duel): boolean {
  return duel.status === "active" && !duel.hasVoted;
}

export function sharePercent(votes: number, duel: Duel): number | null {
  const total = duel.bookA.votes + duel.bookB.votes;
  return total > 0 ? Math.round((votes / total) * 100) : null;
}
