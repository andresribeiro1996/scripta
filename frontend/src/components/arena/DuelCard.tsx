// Head-to-head voting card for one duel: two books side by side, a vote
// button on each, a live tally bar, and a countdown to closes_at.
// Reuses CoverImage (components/BookCard.tsx) rather than reimplementing
// cover rendering — it takes a `book: Record<string, unknown>`, so each
// duel side is adapted into that shape below. The adapted object is
// memoized (useMemo) because CoverImage resets its own resolved-cover
// state whenever it's handed a NEW object reference (see BookCard.tsx's
// own effect deps) — without memoizing here, DuelCard's own 1-second
// countdown re-render (and useArena's 5s poll) would re-trigger a fresh
// cover lookup/flicker on every tick.

import { useMemo } from "react";
import type { Duel, DuelSide } from "../../api/arena";
import { CoverImage } from "../BookCard";
import { useCountdown } from "./useCountdown";

function DuelSideCard({
  side,
  totalVotes,
  isWinner,
  canVote,
  onVote
}: {
  side: DuelSide;
  totalVotes: number;
  isWinner: boolean;
  canVote: boolean;
  onVote: () => void;
}) {
  const pct = totalVotes > 0 ? Math.round((side.votes / totalVotes) * 100) : 0;
  const coverImageBook = useMemo(
    () => ({ Title: side.title, Attribution: side.author, _coverUrl: side.cover ?? undefined }),
    [side.title, side.author, side.cover]
  );
  return (
    <button
      onClick={onVote}
      disabled={!canVote}
      className={`group relative flex flex-1 flex-col overflow-hidden rounded-xl border-2 text-left transition-colors ${
        isWinner ? "border-(--color-accent)" : "border-(--color-border)"
      } ${canVote ? "cursor-pointer hover:border-(--color-accent)" : "cursor-default"}`}
    >
      {/* max-h caps how tall a full-width 2:3 cover can get. Two of
          these sit side by side, so on a phone each is ~160px wide and
          the untamed aspect ratio made it ~240px tall — a single duel
          then filled most of the viewport, and a round of eight was an
          enormous scroll. The cap crops rather than letterboxes
          (CoverImage uses object-cover), which loses a little art but
          keeps a whole match on screen. */}
      <div className="relative aspect-2/3 max-h-36 w-full bg-(--color-border) sm:max-h-56">
        <CoverImage book={coverImageBook} />
      </div>
      <div className="p-2.5 sm:p-3">
        <h4 className="truncate text-sm font-semibold">{side.title}</h4>
        <p className="truncate text-xs text-(--color-text-dim)">{side.author}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-(--color-border)">
          <div className="h-full bg-(--color-accent)" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1 text-xs text-(--color-text-dim)">
          {side.votes} vote{side.votes === 1 ? "" : "s"} ({pct}%)
        </p>
      </div>
    </button>
  );
}

export function DuelCard({
  duel,
  onVote,
  votingDisabledReason
}: {
  duel: Duel;
  onVote: (bookKey: string) => void;
  /** Non-null when voting shouldn't be allowed right now (already voted,
   *  duel settled, tournament not active) — shown instead of the
   *  countdown. */
  votingDisabledReason: string | null;
}) {
  const countdown = useCountdown(duel.closesAt);
  const totalVotes = duel.bookA.votes + duel.bookB.votes;
  const canVote = duel.status === "active" && !votingDisabledReason;

  return (
    <div className="rounded-2xl border border-(--color-border) bg-(--color-surface) p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-(--color-text-dim)">
        <span>
          Round {duel.roundNumber} · Duel {duel.duelIndex + 1}
        </span>
        <span>
          {duel.status === "active"
            ? (votingDisabledReason ?? countdown)
            : duel.status === "tied_pending_tiebreak"
              ? "Tied — awaiting tie-break"
              : "Settled"}
        </span>
      </div>
      <div className="flex gap-3">
        <DuelSideCard
          side={duel.bookA}
          totalVotes={totalVotes}
          isWinner={duel.winnerKey === duel.bookA.key}
          canVote={canVote}
          onVote={() => onVote(duel.bookA.key)}
        />
        <div className="flex items-center px-1 text-sm font-bold text-(--color-text-dim)">VS</div>
        <DuelSideCard
          side={duel.bookB}
          totalVotes={totalVotes}
          isWinner={duel.winnerKey === duel.bookB.key}
          canVote={canVote}
          onVote={() => onVote(duel.bookB.key)}
        />
      </div>
    </div>
  );
}
