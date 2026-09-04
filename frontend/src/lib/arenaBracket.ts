import type { Duel } from "../api/arena";

/** A position in the bracket. `null` where the match hasn't been
 *  generated yet. */
export type BracketSlot = Duel | null;

/** The bracket's full shape, round by round, with each position either
 *  its real duel or `null`.
 *
 *  Derived from `bracketSize`, NOT from the duels that happen to exist —
 *  which is the whole point. The backend generates duels one round at a
 *  time (the arena service's `start` inserts round 1; `advanceRound`
 *  inserts the next as each settles), so during round 1 of a 16-book
 *  tournament only 8 of its 15 matches exist. Laying the bracket out
 *  from `tournament.duels` therefore drew a single row until the
 *  tournament was nearly over — the shape, which is the only reason to
 *  show a bracket rather than a list, appeared exactly when it had
 *  stopped being interesting.
 *
 *  Falls back to the rounds that actually exist when `bracketSize` isn't
 *  a power of two. The service rejects those at creation
 *  (InvalidBracketSizeError), so this is unreachable through the app —
 *  but hand-edited or future data shouldn't produce a skeleton whose
 *  rounds never halve down to a single final.
 *
 *  Lives here rather than inside BracketMap so it can be tested without
 *  a DOM; see scripts/test-arena-bracket.mts. */
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

/** An active match this viewer hasn't voted in — the only state that
 *  asks something of them, and so the only one worth a badge or a
 *  count. */
export function needsVote(duel: Duel): boolean {
  return duel.status === "active" && !duel.hasVoted;
}

/** A duel side's share of the vote, or `null` before anyone has voted.
 *
 *  Deliberately null rather than 0 at zero total: 0/0 has no percentage,
 *  and printing "0%" on both sides of an untouched match asserts
 *  something false — that nobody chose either — when the truth is that
 *  nobody has voted yet. Callers render an en dash for null. */
export function sharePercent(votes: number, duel: Duel): number | null {
  const total = duel.bookA.votes + duel.bookB.votes;
  return total > 0 ? Math.round((votes / total) * 100) : null;
}
