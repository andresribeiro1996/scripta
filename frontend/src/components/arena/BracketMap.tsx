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
// This is the opposite trade: compact read-only tiles — a small cover,
// title and tally per side — with the whole bracket on screen. Two views
// of the same duels (ArenaViewPage's own toggle).
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

/** A duel side's share of the vote, or `null` before anyone has voted.
 *
 *  Deliberately null rather than 0 at zero total: 0/0 has no percentage,
 *  and printing "0%" on both sides of an untouched match states
 *  something false — that nobody chose either — where the truth is that
 *  nobody has voted yet. The tile renders an en dash for that. */
function sharePercent(side: DuelSide, duel: Duel): number | null {
  const total = duel.bookA.votes + duel.bookB.votes;
  return total > 0 ? Math.round((side.votes / total) * 100) : null;
}

function coverBookFor(side: DuelSide) {
  return { Title: side.title, Attribution: side.author, _coverUrl: side.cover ?? undefined };
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
  const pct = sharePercent(side, duel);

  return (
    <button
      onClick={onOpen}
      // The title is gone from the tile, so the accessible name has to
      // carry it — otherwise this is a button labelled only by a
      // percentage, and the covers are decorative images with no text
      // anywhere in the bracket at all.
      aria-label={`${side.title} — ${pct === null ? "no votes yet" : `${pct}% of votes`}`}
      className="flex w-full items-center gap-1.5 px-1.5 py-1.5 text-left hover:bg-(--color-surface-hover) sm:gap-2 sm:px-2"
    >
      {/* Cover only: no title. At a bracket's scale the jacket is the
          faster identifier, and dropping the text buys the art enough
          room to actually be recognisable. Tapping opens the details,
          which is where the title now lives. The winner keeps a ring
          and the loser fades, so a settled match still reads instantly
          without any words. */}
      <div
        className={`relative aspect-2/3 w-[30px] shrink-0 overflow-hidden rounded-xs bg-(--color-border) sm:w-[42px] ${
          isWinner ? "ring-2 ring-(--color-accent)" : ""
        } ${decided && !isWinner ? "opacity-40" : ""}`}
      >
        <CoverImage book={coverBook} />
      </div>
      <span
        className={`ml-auto shrink-0 text-[11px] tabular-nums sm:text-xs ${
          isWinner ? "font-semibold text-(--color-accent)" : "text-(--color-text-dim)"
        }`}
      >
        {pct === null ? "–" : `${pct}%`}
      </span>
    </button>
  );
}

function MatchTile({ duel, onOpen }: { duel: Duel; onOpen: (side: DuelSide) => void }) {
  const decided = duel.winnerKey !== null;
  return (
    <div
      className={`w-full overflow-hidden rounded border bg-(--color-surface) sm:rounded-lg ${
        duel.status === "active" ? "border-(--color-accent)" : "border-(--color-border)"
      }`}
    >
      <MatchSide
        side={duel.bookA}
        duel={duel}
        isWinner={duel.winnerKey === duel.bookA.key}
        decided={decided}
        onOpen={() => onOpen(duel.bookA)}
      />
      <div className="border-t border-(--color-border)" />
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
 *  and how the match it belongs to actually stands — both sides, not
 *  just the tapped one, since "60%" only means something next to the
 *  40% it beat. */
function BookSheet({ side, duel, onClose }: { side: DuelSide; duel: Duel; onClose: () => void }) {
  const coverBook = useMemo(() => coverBookFor(side), [side.title, side.author, side.cover]);
  const decided = duel.winnerKey !== null;
  return (
    <Sheet title="Match" onClose={onClose}>
      <div className="flex gap-3 px-2 pb-1">
        <div className="relative aspect-2/3 w-20 shrink-0 overflow-hidden rounded-lg bg-(--color-border)">
          <CoverImage book={coverBook} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{side.title}</h3>
          <p className="mt-0.5 text-xs text-(--color-text-dim)">{side.author}</p>
          {decided && (
            <p className="mt-1.5 text-xs font-semibold text-(--color-accent)">
              {duel.winnerKey === side.key ? "Advanced" : "Knocked out"}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1 px-2">
        {[duel.bookA, duel.bookB].map((s) => {
          const pct = sharePercent(s, duel);
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
    </Sheet>
  );
}

/** One round of one half of the bracket, as a horizontal row of matches.
 *
 *  `mirrored` flips every connector. The bottom half flows upward, so its
 *  matches feed out of their TOP edge and receive on their BOTTOM — the
 *  exact opposite of the top half. */
function RoundRow({
  duels,
  label,
  mirrored,
  feedsInward,
  receivesFromOutside,
  widthRatio,
  onOpen
}: {
  duels: Duel[];
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
        {duels.map((duel, i) => (
          <div key={duel.id} className="relative flex min-w-0 flex-1 flex-col justify-center">
            {receivesFromOutside && (
              <span className={`absolute left-1/2 ${inward} h-1.5 border-l border-(--color-border) sm:h-2`} aria-hidden />
            )}

            {/* Every match is the same width whatever round it's in —
                see BracketMap's `tileRatio`. The connectors are
                positioned against the CELL rather than the tile, so
                centring a narrower tile inside its cell keeps every stub
                meeting the tile's own centre. */}
            <div className="mx-auto px-0.5 py-2 sm:px-1 sm:py-2.5" style={{ width: `${widthRatio * 100}%` }}>
              <MatchTile duel={duel} onOpen={(side) => onOpen(side, duel)} />
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
                {duels.length > 1 && (
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

export function BracketMap({ tournament }: { tournament: TournamentView }) {
  // Which cover was tapped. Holds the duel alongside the side because a
  // book's share only means anything next to its opponent's.
  const [open, setOpen] = useState<{ side: DuelSide; duel: Duel } | null>(null);
  const rounds = new Map<number, Duel[]>();
  for (const duel of tournament.duels) {
    const list = rounds.get(duel.roundNumber) ?? [];
    list.push(duel);
    rounds.set(duel.roundNumber, list);
  }
  const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
  if (roundNumbers.length === 0) return null;

  const byRound = roundNumbers.map((n) => [...rounds.get(n)!].sort((a, b) => a.duelIndex - b.duelIndex));
  const finalRound = byRound.at(-1)!;
  // The final is the centre row only when it really is a single match. A
  // 2-book "bracket" is nothing but a final, and a partially generated
  // tournament could be shaped oddly; either way, splitting a round that
  // can't halve would silently drop matches.
  const hasCentre = finalRound.length === 1;
  const sideRounds = hasCentre ? byRound.slice(0, -1) : byRound;

  // duelIndex is already the bracket's own order, so the first half of
  // every round belongs to the top and the second to the bottom. That
  // keeps feeders and their successor in the same half — round 2's match
  // 0 is fed by round 1's matches 0 and 1, all three on top — which is
  // what makes the two halves mirror correctly.
  const top = sideRounds.map((duels) => duels.slice(0, Math.ceil(duels.length / 2)));
  const bottom = sideRounds.map((duels) => duels.slice(Math.ceil(duels.length / 2)));

  // Every row spans the same total width, so a row of `c` cells has
  // cells of W/c. To give every tile the same absolute width — that of
  // the busiest row's cell, W/N — a tile takes c/N of its own cell.
  // Round 1 (c === N) fills its cell; the semis (c === 1, N === 4) take
  // a quarter of theirs. Without this, tiles grew as the bracket
  // narrowed: 93px in round 1 against 224px in the semis, for identical
  // content.
  const maxPerRow = Math.max(1, ...sideRounds.map((duels) => Math.ceil(duels.length / 2)));
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
      {top.map((duels, roundIdx) => (
        <RoundRow
          key={`t-${roundIdx}`}
          duels={duels}
          label={labelFor(roundIdx)}
          mirrored={false}
          feedsInward={roundIdx < top.length - 1 || hasCentre}
          receivesFromOutside={roundIdx > 0}
          widthRatio={tileRatio(duels.length)}
          onOpen={(side, duel) => setOpen({ side, duel })}
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
              <MatchTile duel={finalDuel} onOpen={(side) => setOpen({ side, duel: finalDuel })} />
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
      {[...bottom].reverse().map((duels, i) => {
        const roundIdx = bottom.length - 1 - i;
        return (
          <RoundRow
            key={`b-${roundIdx}`}
            duels={duels}
            label={labelFor(roundIdx)}
            mirrored
            feedsInward={roundIdx < bottom.length - 1 || hasCentre}
            receivesFromOutside={roundIdx > 0}
            widthRatio={tileRatio(duels.length)}
            onOpen={(side, duel) => setOpen({ side, duel })}
          />
        );
      })}

      {open && <BookSheet side={open.side} duel={open.duel} onClose={() => setOpen(null)} />}
    </div>
  );
}
