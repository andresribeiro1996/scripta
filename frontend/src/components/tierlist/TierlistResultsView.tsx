// The read-only results board rendered on /vote/:code once voting has
// closed, or once THIS voter has already submitted a ballot (see
// pages/VoteTierlistPage.tsx's four states). Owns the Average/Most-voted/
// Median switch itself: `aggregate` (lib/tierlistResults.ts, Task 9) is
// pure and cheap — its input size tracks the pool × tier count, not the
// number of ballots — so every mode is recomputed on each render with no
// memoization and, crucially, no network request between switches.

import { aggregate, AGGREGATION_MODES, type AggregationMode, type BookResult, type HistogramCell } from "../../lib/tierlistResults";
import { bookKey } from "../../lib/merge";
import { MiniBookTile } from "../murals/blocks/BookBlocks";
import { TierRowEmpty, TierRowShell, TierRowTiles } from "./TierRowShell";
import { useState } from "react";

export interface TierlistResultsViewProps {
  histogram: HistogramCell[];
  tierIds: string[];
  tiers: Array<{ id: string; label: string; color: string }>;
  pool: string[];
  books: Array<Record<string, unknown>>;
  ballotCount: number;
}

function ResultTile({ result, book }: { result: BookResult; book: Record<string, unknown> }) {
  const agreement = Math.round((1 - result.spread) * 100);
  return (
    <div className="flex w-[4em] flex-col gap-0.5">
      <div className="h-[6em] w-[4em] overflow-hidden rounded-lg">
        <MiniBookTile book={book} showTitle={false} showAuthor={false} />
      </div>
      <p className="text-center text-[0.65rem] leading-tight text-(--color-text-dim)">
        {result.votes} {result.votes === 1 ? "vote" : "votes"} · {agreement}% agree
      </p>
    </div>
  );
}

export function TierlistResultsView({ histogram, tierIds, tiers, pool, books, ballotCount }: TierlistResultsViewProps) {
  const [mode, setMode] = useState<AggregationMode>("average");
  const results = aggregate(histogram, tierIds, pool, mode);
  const byKey = new Map(books.map((b) => [bookKey(b), b] as const));

  const byTier = new Map<string, BookResult[]>(tierIds.map((id) => [id, []]));
  const unranked: BookResult[] = [];
  for (const result of results) {
    if (result.tierId === null) {
      unranked.push(result);
      continue;
    }
    byTier.get(result.tierId)?.push(result);
  }
  // Ascending score within a tier: the closest-to-the-tier-above book
  // (lowest mean tier index) leads, the closest-to-slipping-out trails.
  for (const rows of byTier.values()) rows.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-(--color-text-dim)">
          {ballotCount} {ballotCount === 1 ? "ballot" : "ballots"}
        </p>
        {/* Segmented control — markup matches ArenaViewPage's Matches/Bracket
            switch exactly (border + divider + accent-soft active state). */}
        <div className="flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
          {AGGREGATION_MODES.map(({ mode: candidate, label }, i) => (
            <button
              key={candidate}
              onClick={() => setMode(candidate)}
              aria-pressed={mode === candidate}
              className={`flex min-h-11 flex-1 items-center justify-center gap-1.5 px-3 text-sm font-semibold ${
                i > 0 ? "border-l border-(--color-border)" : ""
              } ${mode === candidate ? "bg-(--color-accent-soft) text-(--color-accent)" : "text-(--color-text-dim) hover:bg-(--color-surface-hover)"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {tiers.map((tier) => {
          const rows = byTier.get(tier.id) ?? [];
          return (
            <TierRowShell key={tier.id} tier={{ ...tier, bookKeys: [] }}>
              {rows.length === 0 ? (
                <TierRowEmpty message="Nobody ranked a book here." />
              ) : (
                <TierRowTiles>
                  {rows.map((result) => {
                    const book = byKey.get(result.bookKey);
                    return book ? <ResultTile key={result.bookKey} result={result} book={book} /> : null;
                  })}
                </TierRowTiles>
              )}
            </TierRowShell>
          );
        })}
      </div>

      {unranked.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="px-1 text-xs font-semibold text-(--color-text-dim)">Nobody ranked these</span>
          <div className="flex flex-wrap gap-1.5 rounded-lg border border-dashed border-(--color-border) p-2">
            {unranked.map((result) => {
              const book = byKey.get(result.bookKey);
              return book ? (
                <div key={result.bookKey} className="h-[6em] w-[4em] overflow-hidden rounded-lg">
                  <MiniBookTile book={book} showTitle={false} showAuthor={false} />
                </div>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}
