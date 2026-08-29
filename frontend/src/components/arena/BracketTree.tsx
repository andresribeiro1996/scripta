// Groups a tournament's duels by round and lays them out as columns — a
// classic single-elimination bracket. Uses flex/CSS spacing rather than
// SVG connector lines — good enough at this app's bracket sizes (up to
// 128) and much simpler to keep in sync with real DOM sizing.
//
// `renderDuel` is a render-prop rather than this component fetching/
// rendering DuelCard itself, so BracketTree stays ignorant of voting,
// hasVoted, or any other duel-interaction concern — it only knows how to
// lay duels out.

import type { ReactNode } from "react";
import type { TournamentView } from "../../api/arena";

export function BracketTree({ tournament, renderDuel }: { tournament: TournamentView; renderDuel: (duelId: string) => ReactNode }) {
  const rounds = new Map<number, TournamentView["duels"]>();
  for (const duel of tournament.duels) {
    const list = rounds.get(duel.roundNumber) ?? [];
    list.push(duel);
    rounds.set(duel.roundNumber, list);
  }
  const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
  const lastRoundNumber = roundNumbers.at(-1);

  return (
    <div className="flex gap-8 overflow-x-auto pb-4">
      {roundNumbers.map((roundNumber) => {
        const duels = [...rounds.get(roundNumber)!].sort((a, b) => a.duelIndex - b.duelIndex);
        const isFinal = roundNumber === lastRoundNumber && duels.length === 1;
        return (
          <div key={roundNumber} className="flex w-72 shrink-0 flex-col justify-around gap-6">
            <h3 className="text-center text-xs font-semibold tracking-wide text-(--color-text-dim) uppercase">
              {isFinal ? "Final" : `Round ${roundNumber}`}
            </h3>
            {duels.map((duel) => (
              <div key={duel.id}>{renderDuel(duel.id)}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
