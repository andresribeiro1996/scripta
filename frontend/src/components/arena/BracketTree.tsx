// Groups a tournament's duels by round. Two layouts, because a bracket
// and a phone want opposite things from the same data.
//
// DESKTOP lays the rounds out as columns — a classic single-elimination
// bracket, where seeing round 1 feed round 2 feed the final IS the
// point. Uses flex/CSS spacing rather than SVG connector lines: good
// enough at this app's bracket sizes (up to 128) and much simpler to
// keep in sync with real DOM sizing.
//
// PHONE shows ONE round at a time, picked from a dropdown. The columns
// were horizontally scrollable there, which meant a 16-book bracket's
// four rounds sat off-screen to the right with nothing to suggest they
// existed, and reaching the final meant dragging sideways through every
// earlier round. Horizontal scrolling inside a vertically-scrolling page
// is also easy to trigger by accident. One round, full width, chosen
// deliberately, beats a shape nobody can see the shape of.
//
// `renderDuel` is a render-prop rather than this component fetching/
// rendering DuelCard itself, so BracketTree stays ignorant of voting,
// hasVoted, or any other duel-interaction concern — it only knows how to
// lay duels out.

import { useEffect, useState, type ReactNode } from "react";
import type { TournamentView } from "../../api/arena";
import { OptionSheet } from "../Sheet";

function ChevronLeftIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 6 9 12 15 18" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

export function BracketTree({ tournament, renderDuel }: { tournament: TournamentView; renderDuel: (duelId: string) => ReactNode }) {
  const rounds = new Map<number, TournamentView["duels"]>();
  for (const duel of tournament.duels) {
    const list = rounds.get(duel.roundNumber) ?? [];
    list.push(duel);
    rounds.set(duel.roundNumber, list);
  }
  const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
  const lastRoundNumber = roundNumbers.at(-1);

  function roundLabel(roundNumber: number): string {
    const duels = rounds.get(roundNumber);
    return roundNumber === lastRoundNumber && duels?.length === 1 ? "Final" : `Round ${roundNumber}`;
  }

  // Opens on whichever round is actually live, not round 1 — that's the
  // one with votes to cast. A completed tournament opens on the final,
  // which is where the result is.
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (selectedRound !== null || roundNumbers.length === 0) return;
    const preferred = tournament.status === "completed" ? lastRoundNumber : tournament.currentRound;
    setSelectedRound(roundNumbers.includes(preferred ?? 0) ? preferred! : roundNumbers[0]!);
  }, [selectedRound, roundNumbers, tournament.currentRound, tournament.status, lastRoundNumber]);

  const activeRound = selectedRound !== null && rounds.has(selectedRound) ? selectedRound : roundNumbers[0];
  const currentIndex = roundNumbers.indexOf(activeRound!);

  function duelsIn(roundNumber: number) {
    return [...rounds.get(roundNumber)!].sort((a, b) => a.duelIndex - b.duelIndex);
  }

  if (roundNumbers.length === 0) return null;

  return (
    <>
      {/* Phone: one round, with arrows either side of the dropdown.
          The dropdown alone meant two taps and a decision to move one
          round along, which is the most common thing you do here —
          walking the bracket forward. The arrows make that one tap, and
          the dropdown stays for jumping straight to the final. Arrows
          disable at the ends rather than wrapping: round 1 and the final
          are the edges of a real structure, and silently looping from
          one to the other would misrepresent it. */}
      <div className="sm:hidden">
        {/* One segmented control, not three buttons in a row. The
            three used to sit in a `gap-2` flex with their own borders
            and rounding, which read as three separate things that
            happened to be adjacent — you had to work out that the
            arrows drove the dropdown between them. Sharing a single
            border and splitting it with dividers says "these operate on
            the same value" without a label needing to.

            The container owns the border, rounding, background and
            `overflow-hidden`; the children carry none of their own, so
            their hover fills clip to the rounded corners instead of
            squaring them off. `items-stretch` makes all three the full
            height, so the dividers run edge to edge — with the default
            `items-center` they'd stop short and the seams would look
            broken. This deliberately doesn't reuse toolbarIconClass() or
            TOOLBAR_CONTROL_CLASS: both bring their own border, rounding
            and background, which is exactly what a segment must not
            have. */}
        <div className="mb-4 flex items-stretch overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface)">
          <button
            onClick={() => setSelectedRound(roundNumbers[currentIndex - 1]!)}
            disabled={currentIndex <= 0}
            aria-label="Previous round"
            className="flex w-11 shrink-0 items-center justify-center text-(--color-text-dim) enabled:hover:bg-(--color-surface-hover) enabled:hover:text-(--color-text) disabled:opacity-40"
          >
            <ChevronLeftIcon />
          </button>

          <button
            onClick={() => setPicking(true)}
            aria-label={`Showing ${roundLabel(activeRound!)} — choose a round`}
            className="flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 border-x border-(--color-border) px-3 text-sm font-semibold hover:bg-(--color-surface-hover)"
          >
            <span className="truncate">{roundLabel(activeRound!)}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs font-normal text-(--color-text-dim)">
              {duelsIn(activeRound!).length} match{duelsIn(activeRound!).length === 1 ? "" : "es"}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          <button
            onClick={() => setSelectedRound(roundNumbers[currentIndex + 1]!)}
            disabled={currentIndex < 0 || currentIndex >= roundNumbers.length - 1}
            aria-label="Next round"
            className="flex w-11 shrink-0 items-center justify-center text-(--color-text-dim) enabled:hover:bg-(--color-surface-hover) enabled:hover:text-(--color-text) disabled:opacity-40"
          >
            <ChevronRightIcon />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          {duelsIn(activeRound!).map((duel) => (
            <div key={duel.id}>{renderDuel(duel.id)}</div>
          ))}
        </div>
      </div>

      {/* Desktop: the whole bracket, as columns. */}
      <div className="hidden gap-8 overflow-x-auto pb-4 sm:flex">
        {roundNumbers.map((roundNumber) => (
          <div key={roundNumber} className="flex w-72 shrink-0 flex-col justify-around gap-6">
            <h3 className="text-center text-xs font-semibold tracking-wide text-(--color-text-dim) uppercase">
              {roundLabel(roundNumber)}
            </h3>
            {duelsIn(roundNumber).map((duel) => (
              <div key={duel.id}>{renderDuel(duel.id)}</div>
            ))}
          </div>
        ))}
      </div>

      {picking && (
        <OptionSheet
          title="Round"
          // Values are strings because that's what OptionSheet keys on;
          // mapped back to a number on the way out. The match count sits
          // in the label so the sheet says how much is in each round
          // without having to open them one by one.
          options={roundNumbers.map((n) => ({
            value: String(n),
            label: `${roundLabel(n)} · ${rounds.get(n)!.length} match${rounds.get(n)!.length === 1 ? "" : "es"}`
          }))}
          value={String(activeRound)}
          onSelect={(v) => setSelectedRound(Number(v))}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
