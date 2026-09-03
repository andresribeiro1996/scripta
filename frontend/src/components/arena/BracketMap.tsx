// The whole tournament at a glance — the shape a football/cup bracket
// has, with rounds as columns and elbow connectors showing which two
// matches feed the next one.
//
// Separate from BracketTree, which lays out full DuelCards for VOTING
// (covers, tallies, countdowns, vote buttons). Those cards are ~230px
// tall, so eight of them in round 1 make a bracket metres long — you can
// vote in it, but you can never see it. This is the opposite trade: each
// match is a ~56px tile of two rows, small enough that all four rounds
// of a 16-book bracket fit on one screen, and read-only. Two views of the
// same duels, not one compromised view (ArenaViewPage's own toggle).
//
// Connectors are pure CSS, no SVG and no measuring. Every round is a flex
// column of equal `flex-1` cells, so round r+1's cell j spans exactly
// cells 2j and 2j+1 of round r, and its vertical centre lands exactly on
// the boundary between them. That means the elbow can be drawn with
// borders alone — a stub right from each match, a vertical joining a
// pair, a stub left into the next match — and it stays aligned at any
// height, any bracket size, with no resize listener and nothing to keep
// in sync with the DOM.

import type { Duel, TournamentView } from "../../api/arena";

const STUB = "1rem"; // horizontal run either side of the vertical joiner

function MatchSide({ label, votes, isWinner, decided }: { label: string; votes: number; isWinner: boolean; decided: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-2 px-2 py-1 text-xs ${
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
      className={`w-full overflow-hidden rounded-lg border bg-(--color-surface) ${
        duel.status === "active" ? "border-(--color-accent)" : "border-(--color-border)"
      }`}
    >
      <MatchSide label={duel.bookA.title} votes={duel.bookA.votes} isWinner={duel.winnerKey === duel.bookA.key} decided={decided} />
      <div className="border-t border-(--color-border)" />
      <MatchSide label={duel.bookB.title} votes={duel.bookB.votes} isWinner={duel.winnerKey === duel.bookB.key} decided={decided} />
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

  const lastRoundNumber = roundNumbers.at(-1)!;
  const champion = (() => {
    const final = rounds.get(lastRoundNumber)!;
    if (final.length !== 1 || !final[0]!.winnerKey) return null;
    const duel = final[0]!;
    return duel.winnerKey === duel.bookA.key ? duel.bookA : duel.bookB;
  })();

  return (
    // Horizontal scroll is correct HERE, unlike the voting view: a
    // bracket is a wide object and this is the view whose whole purpose
    // is its shape. It's also opt-in — the round-stepper view remains
    // the default on phones, so nobody meets a sideways scroll without
    // having asked to see the bracket.
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max">
        {roundNumbers.map((roundNumber, roundIdx) => {
          const duels = [...rounds.get(roundNumber)!].sort((a, b) => a.duelIndex - b.duelIndex);
          const isFinal = roundNumber === lastRoundNumber && duels.length === 1;
          // The final round is only the last COLUMN when no winner
          // column follows it; otherwise it still needs a stub out.
          const isLastColumn = roundIdx === roundNumbers.length - 1 && !champion;
          return (
            <div key={roundNumber} className="flex w-44 shrink-0 flex-col">
              <h3 className="mb-2 text-center text-[10.5px] font-semibold tracking-wide text-(--color-text-dim) uppercase">
                {isFinal ? "Final" : `Round ${roundNumber}`}
              </h3>
              <div className="flex flex-1 flex-col">
                {duels.map((duel, i) => (
                  // flex-1 on every cell is what makes the connectors
                  // line up: equal cells mean a pair's shared edge is
                  // exactly the centre of the next round's cell.
                  <div key={duel.id} className="relative flex flex-1 items-center">
                    {/* Stub INTO this match from the previous round. */}
                    {roundIdx > 0 && (
                      <span
                        className="absolute top-1/2 right-full border-t border-(--color-border)"
                        style={{ width: STUB }}
                        aria-hidden
                      />
                    )}

                    <div className="w-full px-4">
                      <MatchTile duel={duel} />
                    </div>

                    {!isLastColumn && (
                      <>
                        {/* Stub OUT of this match. */}
                        <span
                          className="absolute top-1/2 left-full border-t border-(--color-border)"
                          style={{ width: STUB }}
                          aria-hidden
                        />
                        {/* Half of the vertical joining this match to its
                            pair: the even cell draws downward from its
                            centre, the odd cell upward from its centre.
                            Together they meet exactly on the shared edge
                            — which is the next round's cell centre.
                            Skipped when the round has a single match (the
                            final feeding the winner column): there's no
                            pair to join, and a half-vertical would dangle
                            off into nothing. */}
                        {duels.length > 1 && (
                          <span
                            className={`absolute border-l border-(--color-border) ${i % 2 === 0 ? "top-1/2 bottom-0" : "top-0 bottom-1/2"}`}
                            style={{ left: `calc(100% + ${STUB})` }}
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
        })}

        {champion && (
          <div className="flex w-44 shrink-0 flex-col">
            <h3 className="mb-2 text-center text-[10.5px] font-semibold tracking-wide text-(--color-accent) uppercase">Winner</h3>
            <div className="relative flex flex-1 items-center">
              <span className="absolute top-1/2 right-full border-t border-(--color-border)" style={{ width: STUB }} aria-hidden />
              <div className="w-full px-4">
                <div className="rounded-lg border border-(--color-accent) bg-(--color-accent-soft) px-2 py-2 text-xs font-semibold text-(--color-accent)">
                  <span className="line-clamp-2">{champion.title}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
