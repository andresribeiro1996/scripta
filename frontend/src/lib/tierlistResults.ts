// Turns a vote histogram into a per-book result. Pure — no network, no
// react-query, no DOM — which is why all three aggregation modes live
// here and are covered by scripts/test-tierlist-results.mts.
//
// The histogram is per-book × per-tier counts, so its size depends on the
// pool and the tier count but NOT on how many people voted: 10 voters and
// 10,000 produce the same input. Every mode is derived from it here rather
// than being fetched separately, so switching modes never hits the network.

export type AggregationMode = "average" | "plurality" | "median";

export interface HistogramCell {
  bookKey: string;
  tierId: string;
  votes: number;
}

export interface BookResult {
  bookKey: string;
  /** null when nobody ranked this book. */
  tierId: string | null;
  /** The mean tier index, kept raw so books can be ordered WITHIN a tier.
   *  null when nobody ranked this book. */
  score: number | null;
  votes: number;
  /** Share of voters who did NOT put the book in its winning tier: 0 is
   *  unanimous. Depends on the mode, since the winning tier does. */
  spread: number;
}

export const AGGREGATION_MODES: Array<{ mode: AggregationMode; label: string }> = [
  { mode: "average", label: "Average" },
  { mode: "plurality", label: "Most-voted" },
  { mode: "median", label: "Median" }
];

export function aggregate(
  histogram: HistogramCell[],
  tierIds: string[],
  pool: string[],
  mode: AggregationMode
): BookResult[] {
  const tierIndex = new Map(tierIds.map((id, index) => [id, index] as const));

  // votesByBook[bookKey][tierIndex] = count. A cell naming a tier that no
  // longer exists is dropped rather than throwing — a frozen community
  // copy shouldn't be able to produce one, but this is public input on a
  // read path.
  const votesByBook = new Map<string, number[]>();
  for (const cell of histogram) {
    const index = tierIndex.get(cell.tierId);
    if (index === undefined) continue;
    const counts = votesByBook.get(cell.bookKey) ?? new Array<number>(tierIds.length).fill(0);
    counts[index] += cell.votes;
    votesByBook.set(cell.bookKey, counts);
  }

  return pool.map((bookKey) => {
    const counts = votesByBook.get(bookKey);
    const total = counts?.reduce((sum, n) => sum + n, 0) ?? 0;
    if (!counts || total === 0) {
      return { bookKey, tierId: null, score: null, votes: 0, spread: 0 };
    }

    const score = counts.reduce((sum, n, index) => sum + n * index, 0) / total;
    const winner = winningIndex(counts, total, score, mode);
    return {
      bookKey,
      tierId: tierIds[winner] ?? null,
      score,
      votes: total,
      spread: 1 - (counts[winner] ?? 0) / total
    };
  });
}

/** A ballot is exactly the books the voter PLACED. Anything still sitting
 *  in the pool is left out entirely — that absence is how "no opinion" is
 *  recorded, and it's why results carry a per-book vote count. */
export function toPlacements(data: { tiers: Array<{ id: string; bookKeys: string[] }> }): Array<{ bookKey: string; tierId: string }> {
  return data.tiers.flatMap((tier) => tier.bookKeys.map((bookKey) => ({ bookKey, tierId: tier.id })));
}

function winningIndex(counts: number[], total: number, score: number, mode: AggregationMode): number {
  if (mode === "average") {
    // Math.round would send an exact .5 DOWN the ladder (1.5 → 2); every
    // tie in this file breaks toward the higher tier, so round the other
    // way at the halfway point.
    return Math.max(0, Math.min(counts.length - 1, Math.ceil(score - 0.5)));
  }

  if (mode === "plurality") {
    let best = 0;
    for (let index = 1; index < counts.length; index++) {
      // Strictly greater, so the earliest (highest) tier keeps a tie.
      if ((counts[index] ?? 0) > (counts[best] ?? 0)) best = index;
    }
    return best;
  }

  // Median: walk the ballots in tier order and stop at the middle one.
  // ceil(total / 2) is the position that breaks an even split toward the
  // higher tier (4 votes → the 2nd, not the 3rd).
  const target = Math.ceil(total / 2);
  let seen = 0;
  for (let index = 0; index < counts.length; index++) {
    seen += counts[index] ?? 0;
    if (seen >= target) return index;
  }
  return counts.length - 1;
}
