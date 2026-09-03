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
// This is the opposite trade: compact read-only tiles, whole bracket on
// screen. Two views of the same duels (ArenaViewPage's own toggle).
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

import type { Duel, DuelSide, TournamentView } from "../../api/arena";

function MatchSide({ label, votes, isWinner, decided }: { label: string; votes: number; isWinner: boolean; decided: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-1 px-1.5 py-0.5 text-[10px] sm:px-2 sm:py-1 sm:text-[11px] ${
        isWinner ? "font-semibold text-(--color-text)" : decided ? "text-(--color-text-dim)" : "text-(--color-text)"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`shrink-0 tabular-nums ${isWinner ? "text-(--color-accent)" : "text-(--color-text-dim)"}`}>{votes}</span>
    </div>
  );
}

function MatchTile({ duel }: { duel: Duel }) {
  const decided = duel.winnerKey !== null;
  return (
    <div
      className={`w-full overflow-hidden rounded border bg-(--color-surface) sm:rounded-lg ${
        duel.status === "active" ? "border-(--color-accent)" : "border-(--color-border)"
      }`}
    >
      <MatchSide label={duel.bookA.title} votes={duel.bookA.votes} isWinner={duel.winnerKey === duel.bookA.key} decided={decided} />
      <div className="border-t border-(--color-border)" />
      <MatchSide label={duel.bookB.title} votes={duel.bookB.votes} isWinner={duel.winnerKey === duel.bookB.key} decided={decided} />
    </div>
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
  receivesFromOutside
}: {
  duels: Duel[];
  label: string;
  mirrored: boolean;
  feedsInward: boolean;
  receivesFromOutside: boolean;
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

            <div className="w-full px-0.5 py-1.5 sm:px-1 sm:py-2">
              <MatchTile duel={duel} />
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
        />
      ))}

      {finalDuel && (
        <div className="flex flex-col">
          <p className="text-center text-[8.5px] font-semibold tracking-wide text-(--color-accent) uppercase sm:text-[10px]">Final</p>
          <div className="relative mx-auto flex w-full max-w-56 flex-col justify-center">
            {/* Receives from BOTH halves, so it takes a stub on each edge
                — the only cell in the bracket that does. */}
            <span className="absolute top-0 left-1/2 h-1.5 border-l border-(--color-border) sm:h-2" aria-hidden />
            <span className="absolute bottom-0 left-1/2 h-1.5 border-l border-(--color-border) sm:h-2" aria-hidden />
            <div className="w-full px-0.5 py-1.5 sm:px-1 sm:py-2">
              <MatchTile duel={finalDuel} />
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
          />
        );
      })}
    </div>
  );
}
