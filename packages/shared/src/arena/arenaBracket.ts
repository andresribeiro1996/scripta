import type { Duel, DuelSide } from "./types.js";

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

export function roundLabel(slotCount: number, roundNumber: number): string {
  if (slotCount === 1) return "Final";
  if (slotCount === 2) return "Semis";
  if (slotCount === 4) return "Quarters";
  return `Round ${roundNumber}`;
}

export function needsVote(duel: Duel): boolean {
  return duel.status === "active" && !duel.hasVoted;
}

export function sharePercent(votes: number, duel: Duel): number | null {
  const total = duel.bookA.votes + duel.bookB.votes;
  return total > 0 ? Math.round((votes / total) * 100) : null;
}

export function duelWinner(duel: Duel): DuelSide | null {
  if (duel.status !== "settled" || !duel.winnerWorkId) return null;
  if (duel.bookA.workId === duel.winnerWorkId) return duel.bookA;
  return duel.bookB.workId === duel.winnerWorkId ? duel.bookB : null;
}
