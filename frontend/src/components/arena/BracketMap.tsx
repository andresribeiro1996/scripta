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

/** One book's half of a match tile. A plain div, NOT a button: the whole
 *  tile is the tap target now (see MatchTile). */
function MatchSide({ side, duel, isWinner, decided }: { side: DuelSide; duel: Duel; isWinner: boolean; decided: boolean }) {
  // Memoized for the same reason DuelCard memoizes its own: CoverImage
  // resets its resolved-cover state whenever it is handed a NEW object
  // reference, so without this every poll tick (useArena refetches every
  // 5s) would restart the lookup for all 30 covers in a 16-book bracket
  // and flicker the lot.
  const coverBook = useMemo(() => coverBookFor(side), [side.title, side.author, side.cover]);
  const pct = sharePercent(side.votes, duel);

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-0.5 py-1 sm:gap-1 sm:py-1.5">
      {/* Cover only: no title. At a bracket's scale the jacket is the
          faster identifier, and dropping the text buys the art enough
          room to actually be recognisable. The title lives in the sheet.
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
    </div>
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

function MatchTile({ duel, onOpen }: { duel: BracketSlot; onOpen: () => void }) {
  if (!duel) return <EmptyTile />;
  const decided = duel.winnerKey !== null;
  const pctA = sharePercent(duel.bookA.votes, duel);
  const pctB = sharePercent(duel.bookB.votes, duel);

  return (
    // The whole MATCH is the target, not each cover. A cover is 42px on
    // a phone — under the 44px comfortable minimum — inside a surface
    // that is 763px tall and actively scrolled, so per-cover targets
    // were both hard to hit and easy to hit by accident. The tile is
    // ~86px, and "tap the match" is also the truer unit: the sheet shows
    // both books either way, so which half you touched never mattered.
    <button
      onClick={onOpen}
      // The bracket contains no text at all, so the accessible name has
      // to carry the whole match — two covers and two percentages are
      // nothing to a screen reader otherwise.
      aria-label={
        `${duel.bookA.title} versus ${duel.bookB.title}` +
        (pctA === null ? ", no votes yet" : `, ${pctA}% to ${pctB}%`) +
        (needsVote(duel) ? ", you haven't voted" : "") +
        (decided ? `, ${duel.winnerKey === duel.bookA.key ? duel.bookA.title : duel.bookB.title} advanced` : "")
      }
      className={`relative flex w-full items-stretch rounded border bg-(--color-surface) text-left hover:bg-(--color-surface-hover) sm:rounded-lg ${
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
      <MatchSide side={duel.bookA} duel={duel} isWinner={duel.winnerKey === duel.bookA.key} decided={decided} />
      <div className="w-px shrink-0 bg-(--color-border)" />
      <MatchSide side={duel.bookB} duel={duel} isWinner={duel.winnerKey === duel.bookB.key} decided={decided} />
    </button>
  );
}

/** One book inside the match sheet: cover, title, author, tally. */
function SheetSide({ side, duel }: { side: DuelSide; duel: Duel }) {
  const coverBook = useMemo(() => coverBookFor(side), [side.title, side.author, side.cover]);
  const pct = sharePercent(side.votes, duel);
  const won = duel.winnerKey === side.key;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center text-center">
      <div className={`relative aspect-2/3 w-16 overflow-hidden rounded-lg bg-(--color-border) ${won ? "ring-2 ring-(--color-accent)" : ""}`}>
        <CoverImage book={coverBook} />
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs font-semibold">{side.title}</p>
      <p className="mt-0.5 line-clamp-1 text-[11px] text-(--color-text-dim)">{side.author}</p>
      <p className={`mt-1 text-sm font-semibold tabular-nums ${won ? "text-(--color-accent)" : ""}`}>
        {pct === null ? "–" : `${pct}%`}
      </p>
      <p className="text-[11px] text-(--color-text-dim) tabular-nums">
        {side.votes} vote{side.votes === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** What a tapped match opens.
 *
 *  Match-first, not book-first: the tile is now tapped as a whole, so
 *  there's no "the one you touched" to lead with, and a share only means
 *  anything beside the share it beat. Carries everything the tile drops
 *  (titles, authors, exact counts, time left) and — when the match is
 *  live and this viewer hasn't voted — the vote itself, so spotting a
 *  live match in the bracket doesn't mean going to find it in Matches.
 *
 *  Voting stays an explicit labelled button rather than a tap on the
 *  cover. A vote is permanent (there is no unvote anywhere in the API),
 *  and the bracket's covers are 42px inside a tall scrolling surface —
 *  small target plus irreversible plus no undo is the wrong combination.
 *  DuelCard votes on a plain tap because its targets are ~160px and
 *  voting is that view's entire purpose. */
function MatchSheet({
  duel,
  canVote,
  voting,
  onVote,
  onClose
}: {
  duel: Duel;
  canVote: boolean;
  voting: boolean;
  onVote: ((bookKey: string) => void) | undefined;
  onClose: () => void;
}) {
  const countdown = useCountdown(duel.closesAt);
  const decided = duel.winnerKey !== null;
  return (
    <Sheet title="Match" onClose={onClose}>
      <div className="flex items-start gap-2 px-2 pt-1">
        <SheetSide side={duel.bookA} duel={duel} />
        <span className="self-center text-[11px] font-semibold text-(--color-text-dim) uppercase">vs</span>
        <SheetSide side={duel.bookB} duel={duel} />
      </div>

      <p className="mt-3 text-center text-xs text-(--color-text-dim)">
        {decided
          ? `${duel.winnerKey === duel.bookA.key ? duel.bookA.title : duel.bookB.title} advanced`
          : duel.status === "active"
            ? countdown
            : "Waiting on a tiebreak"}
      </p>

      {canVote && onVote && (
        <div className="mt-3 px-2">
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
      {!canVote && duel.hasVoted && !decided && (
        <p className="mt-3 px-2 text-center text-xs text-(--color-text-dim)">You've already voted in this match.</p>
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
  onOpen: (duel: Duel) => void;
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
              <MatchTile duel={duel} onOpen={() => duel && onOpen(duel)} />
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
  // Which match is open. An id, not the duel object: useArena refetches
  // every 5s, so a captured reference would freeze the percentages and
  // the vote state at whatever they were when the sheet opened.
  const [open, setOpen] = useState<string | null>(null);

  // Resolved every render from the live tournament, never held in state.
  const openDuel = open ? (tournament.duels.find((d) => d.id === open) ?? null) : null;

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
          onOpen={(duel) => setOpen(duel.id)}
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
              <MatchTile duel={finalDuel} onOpen={() => finalDuel && setOpen(finalDuel.id)} />
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
            onOpen={(duel) => setOpen(duel.id)}
          />
        );
      })}

      {/* The duel is looked up by id rather than captured when the
          cover was tapped: useArena refetches every 5s, so a held
          reference would freeze the percentages (and the vote state) at
          whatever they were when the sheet opened. */}
      {openDuel && (
        <MatchSheet
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
