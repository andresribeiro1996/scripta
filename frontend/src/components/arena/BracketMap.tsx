// The whole tournament at a glance, as a two-sided bracket running
// VERTICALLY: the top half flows down, the bottom half flows up, and
// they meet at a final in the middle.
//
// Transposed from the usual left-to-right layout because a phone is tall
// and narrow, and the two orientations spend that budget very
// differently. Laid out horizontally, a 16-book bracket needs
// 2*(rounds-1)+1 = 7 columns; vertically, the widest ROW is a half of
// round 1, which is bracketSize/4 = 4 tiles. On a 375px screen that is
// ~94px per tile instead of ~53px — the difference between a title you
// can read and a three-character stub. The cost is height, which is the
// axis a phone has to spare and which scrolls naturally anyway.
//
// Separate from BracketTree, which lays out full DuelCards for VOTING
// (covers, tallies, countdowns, vote buttons). Those cards are ~230px
// tall, so eight of them make a bracket you can vote in but never see.
// This is the opposite trade: compact read-only tiles — a cover per
// side, side by side, its vote share below it — with the whole bracket
// on screen. Two views of the same duels (ArenaViewPage's own toggle).
//
// NO horizontal scroll at any bracket size or width: cells are `flex-1
// min-w-0`, so a row divides whatever width there is rather than
// claiming a fixed width and overflowing.
//
// Connectors are pure CSS — no SVG, no measuring, no resize listener.
// Every round is a flex ROW of equal `flex-1` cells, so the next round's
// cell spans exactly two of them and its centre lands on their shared
// edge. The elbow is then just borders, drawn INSIDE each cell's own
// padding: with flexible cells, anything hanging past a cell's boundary
// would overlap its neighbour instead of meeting it.

import { useMemo, useState } from "react";
import type { Duel, DuelSide, TournamentView } from "../../api/arena";
import { CoverImage } from "../BookCard";
import { Sheet } from "../Sheet";
import { bracketShape, needsVote, sharePercent, type BracketSlot } from "../../lib/arenaBracket";
import { useCountdown } from "./useCountdown";

function coverBookFor(side: DuelSide) {
  return { Title: side.title, Attribution: side.author, _coverUrl: side.cover ?? undefined };
}

function CheckBadge() {
  return (
    <span
      className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-(--color-accent) text-white sm:h-4 sm:w-4"
      aria-hidden
    >
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

function MatchSide({
  side,
  duel,
  isWinner,
  decided,
  onOpen
}: {
  side: DuelSide;
  duel: Duel;
  isWinner: boolean;
  decided: boolean;
  onOpen: () => void;
}) {
  // Memoized for the same reason DuelCard memoizes its own: CoverImage
  // resets its resolved-cover state whenever it is handed a NEW object
  // reference, so without this every poll tick (useArena refetches every
  // 5s) would restart the lookup for all 30 covers in a 16-book bracket
  // and flicker the lot.
  const coverBook = useMemo(() => coverBookFor(side), [side.title, side.author, side.cover]);
  const pct = sharePercent(side.votes, duel);

  return (
    <button
      onClick={onOpen}
      // The title is gone from the tile, so the accessible name has to
      // carry it — otherwise this is a button labelled only by a
      // percentage, and the covers are decorative images with no text
      // anywhere in the bracket at all.
      aria-label={`${side.title} — ${pct === null ? "no votes yet" : `${pct}% of votes`}${isWinner ? ", advanced" : ""}`}
      className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-1 hover:bg-(--color-surface-hover) sm:gap-1 sm:py-1.5"
    >
      {/* Cover only: no title. At a bracket's scale the jacket is the
          faster identifier, and dropping the text buys the art enough
          room to actually be recognisable. Tapping opens the details,
          which is where the title now lives.
          The winner carries a check badge as well as the accent ring —
          ring colour and a faded loser encode the result in hue and
          opacity alone, which a colourblind viewer may not see at all.
          The badge is a shape, so it survives that. */}
      <div
        className={`relative aspect-2/3 w-full max-w-[42px] rounded-xs bg-(--color-border) sm:max-w-[56px] ${
          isWinner ? "ring-2 ring-(--color-accent)" : ""
        } ${decided && !isWinner ? "opacity-45" : ""}`}
      >
        <div className="absolute inset-0 overflow-hidden rounded-xs">
          <CoverImage book={coverBook} />
        </div>
        {isWinner && <CheckBadge />}
      </div>
      <span
        className={`shrink-0 text-[11px] tabular-nums sm:text-xs ${
          isWinner ? "font-semibold text-(--color-accent)" : "text-(--color-text-dim)"
        }`}
      >
        {pct === null ? "–" : `${pct}%`}
      </span>
    </button>
  );
}

/** A match that hasn't been generated yet: the slot exists in the
 *  bracket's shape, but the books that will meet there depend on results
 *  that haven't happened. Drawn as two blank covers so the row still has
 *  a match's exact height and the connectors still land on it. */
function EmptyTile() {
  return (
    <div className="flex w-full items-stretch overflow-hidden rounded border border-dashed border-(--color-border) sm:rounded-lg">
      {[0, 1].map((i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-1 sm:gap-1 sm:py-1.5">
          <div className="aspect-2/3 w-full max-w-[42px] rounded-xs bg-(--color-border) opacity-40 sm:max-w-[56px]" />
          <span className="text-[11px] text-(--color-text-dim) opacity-60 sm:text-xs">–</span>
        </div>
      ))}
    </div>
  );
}

function MatchTile({ duel, onOpen }: { duel: BracketSlot; onOpen: (side: DuelSide) => void }) {
  if (!duel) return <EmptyTile />;
  const decided = duel.winnerKey !== null;
  return (
    <div
      className={`relative flex w-full items-stretch overflow-visible rounded border bg-(--color-surface) sm:rounded-lg ${
        duel.status === "active" ? "border-(--color-accent)" : "border-(--color-border)"
      }`}
    >
      {/* A live match you haven't voted in is the only thing here that
          asks something of you, so it gets the one attention-grabbing
          mark in the view. Without it an active match looks like any
          other and the bracket stays a scoreboard. */}
      {needsVote(duel) && (
        <span
          className="absolute -top-1 -right-1 z-10 h-2.5 w-2.5 rounded-full bg-(--color-accent) ring-2 ring-(--color-bg)"
          aria-hidden
        />
      )}
      <MatchSide
        side={duel.bookA}
        duel={duel}
        isWinner={duel.winnerKey === duel.bookA.key}
        decided={decided}
        onOpen={() => onOpen(duel.bookA)}
      />
      <div className="w-px shrink-0 bg-(--color-border)" />
      <MatchSide
        side={duel.bookB}
        duel={duel}
        isWinner={duel.winnerKey === duel.bookB.key}
        decided={decided}
        onOpen={() => onOpen(duel.bookB)}
      />
    </div>
  );
}

/** What a tapped cover opens. The bracket shows no words at all, so this
 *  carries everything the tile dropped: which book it is, who wrote it,
 *  how the match stands on BOTH sides (a "60%" means nothing without the
 *  40% it beat), how long is left — and, when the match is live and this
 *  viewer hasn't voted, the vote itself. Without that last part, seeing
 *  a live match here meant switching to the Matches view and hunting for
 *  its round to act on it. */
function MatchSheet({
  side,
  duel,
  canVote,
  voting,
  onVote,
  onClose
}: {
  side: DuelSide;
  duel: Duel;
  canVote: boolean;
  voting: boolean;
  onVote: ((bookKey: string) => void) | undefined;
  onClose: () => void;
}) {
  const coverBook = useMemo(() => coverBookFor(side), [side.title, side.author, side.cover]);
  const decided = duel.winnerKey !== null;
  const countdown = useCountdown(duel.closesAt);
  return (
    <Sheet title="Match" onClose={onClose}>
      <div className="flex gap-3 px-2 pb-1">
        <div className="relative aspect-2/3 w-20 shrink-0 overflow-hidden rounded-lg bg-(--color-border)">
          <CoverImage book={coverBook} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{side.title}</h3>
          <p className="mt-0.5 text-xs text-(--color-text-dim)">{side.author}</p>
          {decided ? (
            <p className="mt-1.5 text-xs font-semibold text-(--color-accent)">
              {duel.winnerKey === side.key ? "Advanced" : "Knocked out"}
            </p>
          ) : (
            duel.status === "active" && <p className="mt-1.5 text-xs text-(--color-text-dim)">{countdown}</p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1 px-2">
        {[duel.bookA, duel.bookB].map((s) => {
          const pct = sharePercent(s.votes, duel);
          return (
            <div key={s.key} className="flex items-center gap-2 text-xs">
              <span className={`min-w-0 flex-1 truncate ${s.key === side.key ? "font-semibold" : "text-(--color-text-dim)"}`}>
                {s.title}
              </span>
              <span className="shrink-0 tabular-nums text-(--color-text-dim)">
                {s.votes} vote{s.votes === 1 ? "" : "s"}
              </span>
              <span className="w-9 shrink-0 text-right tabular-nums font-semibold">{pct === null ? "–" : `${pct}%`}</span>
            </div>
          );
        })}
      </div>

      {canVote && onVote && (
        <div className="mt-4 px-2">
          <p className="mb-1.5 text-xs font-semibold text-(--color-text-dim)">Vote for</p>
          <div className="flex gap-2">
            {[duel.bookA, duel.bookB].map((s) => (
              <button
                key={s.key}
                onClick={() => onVote(s.key)}
                disabled={voting}
                className="min-h-11 min-w-0 flex-1 truncate rounded-lg bg-(--color-accent) px-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {s.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {!canVote && duel.hasVoted && (
        <p className="mt-4 px-2 text-xs text-(--color-text-dim)">You've already voted in this match.</p>
      )}
    </Sheet>
  );
}

/** One round of one half of the bracket, as a horizontal row of matches.
 *
 *  `mirrored` flips every connector. The bottom half flows upward, so its
 *  matches feed out of their TOP edge and receive on their BOTTOM — the
 *  exact opposite of the top half. */
function RoundRow({
  slots,
  label,
  mirrored,
  feedsInward,
  receivesFromOutside,
  widthRatio,
  onOpen
}: {
  slots: BracketSlot[];
  label: string;
  mirrored: boolean;
  feedsInward: boolean;
  receivesFromOutside: boolean;
  /** This row's tile width as a fraction of its CELL, so every tile in
   *  the bracket comes out the same absolute width. See BracketMap's
   *  `tileRatio` for the arithmetic. */
  widthRatio: number;
  onOpen: (side: DuelSide, duel: Duel) => void;
}) {
  const outward = mirrored ? "top-0" : "bottom-0";
  const inward = mirrored ? "bottom-0" : "top-0";
  return (
    <div className="flex flex-col">
      <p
        className={`text-center text-[8.5px] font-semibold tracking-wide text-(--color-text-dim) uppercase sm:text-[10px] ${
          mirrored ? "order-last mt-1" : "mb-1"
        }`}
      >
        {label}
      </p>
      <div className="flex items-stretch">
        {slots.map((duel, i) => (
          // Keyed by position, not duel id: an empty slot has no id, and
          // the position is what's stable as rounds fill in anyway.
          <div key={`${label}-${i}`} className="relative flex min-w-0 flex-1 flex-col justify-center">
            {receivesFromOutside && (
              <span className={`absolute left-1/2 ${inward} h-1.5 border-l border-(--color-border) sm:h-2`} aria-hidden />
            )}

            {/* Every match is the same width whatever round it's in —
                see BracketMap's `tileRatio`. The connectors are
                positioned against the CELL rather than the tile, so
                centring a narrower tile inside its cell keeps every stub
                meeting the tile's own centre. */}
            <div className="mx-auto px-0.5 py-2 sm:px-1 sm:py-2.5" style={{ width: `${widthRatio * 100}%` }}>
              <MatchTile duel={duel} onOpen={(side) => duel && onOpen(side, duel)} />
            </div>

            {feedsInward && (
              <>
                <span className={`absolute left-1/2 ${outward} h-1.5 border-l border-(--color-border) sm:h-2`} aria-hidden />
                {/* Half of the horizontal joining this match to its pair:
                    the even cell draws from its centre to its outer edge,
                    the odd cell from its outer edge back to its centre,
                    and they meet on the shared edge — which is exactly
                    the next round's cell centre. Skipped for a
                    single-match round (a semi feeding the final), where
                    there is no pair and a half-line would dangle into
                    nothing. */}
                {slots.length > 1 && (
                  <span
                    className={`absolute ${outward} border-t border-(--color-border) ${i % 2 === 0 ? "right-0 left-1/2" : "right-1/2 left-0"}`}
                    aria-hidden
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BracketMap({
  tournament,
  onVote,
  votingDuelId
}: {
  tournament: TournamentView;
  /** Casts a vote. Omitted for a viewer who can't vote at all. */
  onVote?: (duelId: string, bookKey: string) => void;
  /** The duel whose vote is currently in flight, so its buttons disable. */
  votingDuelId?: string | null;
}) {
  // Which cover was tapped. Holds the duel alongside the side because a
  // book's share only means anything next to its opponent's.
  const [open, setOpen] = useState<{ side: DuelSide; duelId: string } | null>(null);

  // Resolved every render from the live tournament, never held in state.
  const openDuel = open ? (tournament.duels.find((d) => d.id === open.duelId) ?? null) : null;

  // The SHAPE comes from bracketSize, not from the duels that exist —
  // see lib/arenaBracket.ts for why that distinction is the whole point.
  const byRound = bracketShape(tournament.bracketSize, tournament.duels);

  if (byRound.length === 0) return null;

  const roundNumbers = byRound.map((_, i) => i + 1);
  const finalRound = byRound.at(-1)!;
  // The final is the centre row only when it really is a single match. A
  // 2-book "bracket" is nothing but a final; splitting a round that
  // can't halve would silently drop matches.
  const hasCentre = finalRound.length === 1;
  const sideRounds = hasCentre ? byRound.slice(0, -1) : byRound;

  // duelIndex is already the bracket's own order, so the first half of
  // every round belongs to the top and the second to the bottom. That
  // keeps feeders and their successor in the same half — round 2's match
  // 0 is fed by round 1's matches 0 and 1, all three on top — which is
  // what makes the two halves mirror correctly.
  const top = sideRounds.map((slots) => slots.slice(0, Math.ceil(slots.length / 2)));
  const bottom = sideRounds.map((slots) => slots.slice(Math.ceil(slots.length / 2)));

  // Every row spans the same total width, so a row of `c` cells has
  // cells of W/c. To give every tile the same absolute width — that of
  // the busiest row's cell, W/N — a tile takes c/N of its own cell.
  // Round 1 (c === N) fills its cell; the semis (c === 1, N === 4) take
  // a quarter of theirs. Without this, tiles grew as the bracket
  // narrowed: 93px in round 1 against 224px in the semis, for identical
  // content.
  const maxPerRow = Math.max(1, ...sideRounds.map((slots) => Math.ceil(slots.length / 2)));
  const tileRatio = (cells: number) => cells / maxPerRow;

  function labelFor(roundIdx: number): string {
    const perSide = top[roundIdx]!.length;
    if (perSide === 1) return "Semis";
    if (perSide === 2) return "Quarters";
    return `Round ${roundNumbers[roundIdx]}`;
  }

  const finalDuel = hasCentre ? finalRound[0]! : null;
  const champion: DuelSide | null =
    finalDuel && finalDuel.winnerKey
      ? finalDuel.winnerKey === finalDuel.bookA.key
        ? finalDuel.bookA
        : finalDuel.bookB
      : null;

  return (
    <div className="flex w-full flex-col">
      {/* Top half: outermost round first, narrowing downward. */}
      {top.map((slots, roundIdx) => (
        <RoundRow
          key={`t-${roundIdx}`}
          slots={slots}
          label={labelFor(roundIdx)}
          mirrored={false}
          feedsInward={roundIdx < top.length - 1 || hasCentre}
          receivesFromOutside={roundIdx > 0}
          widthRatio={tileRatio(slots.length)}
          onOpen={(side, duel) => setOpen({ side, duelId: duel.id })}
        />
      ))}

      {finalDuel && (
        <div className="flex flex-col">
          <p className="text-center text-[8.5px] font-semibold tracking-wide text-(--color-accent) uppercase sm:text-[10px]">Final</p>
          <div className="relative flex w-full flex-col justify-center">
            {/* Receives from BOTH halves, so it takes a stub on each edge
                — the only cell in the bracket that does. */}
            <span className="absolute top-0 left-1/2 h-1.5 border-l border-(--color-border) sm:h-2" aria-hidden />
            <span className="absolute bottom-0 left-1/2 h-1.5 border-l border-(--color-border) sm:h-2" aria-hidden />
            <div className="mx-auto px-0.5 py-2 sm:px-1 sm:py-2.5" style={{ width: `${tileRatio(1) * 100}%` }}>
              <MatchTile duel={finalDuel} onOpen={(side) => finalDuel && setOpen({ side, duelId: finalDuel.id })} />
              {champion && (
                <p className="mt-1 truncate text-center text-[10px] font-semibold text-(--color-accent) sm:text-[11px]">
                  🏆 {champion.title}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom half: rendered inner-to-outer, so it mirrors the top. */}
      {[...bottom].reverse().map((slots, i) => {
        const roundIdx = bottom.length - 1 - i;
        return (
          <RoundRow
            key={`b-${roundIdx}`}
            slots={slots}
            label={labelFor(roundIdx)}
            mirrored
            feedsInward={roundIdx < bottom.length - 1 || hasCentre}
            receivesFromOutside={roundIdx > 0}
            widthRatio={tileRatio(slots.length)}
            onOpen={(side, duel) => setOpen({ side, duelId: duel.id })}
          />
        );
      })}

      {/* The duel is looked up by id rather than captured when the
          cover was tapped: useArena refetches every 5s, so a held
          reference would freeze the percentages (and the vote state) at
          whatever they were when the sheet opened. */}
      {openDuel && (
        <MatchSheet
          side={open!.side}
          duel={openDuel}
          canVote={tournament.status === "active" && openDuel.status === "active" && !openDuel.hasVoted && Boolean(onVote)}
          voting={votingDuelId === openDuel.id}
          onVote={onVote ? (bookKey) => onVote(openDuel.id, bookKey) : undefined}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
