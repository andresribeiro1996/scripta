import { bracketShape, countdownLabel, needsVote, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import type { TournamentView } from "./api";

const ALL_ARENA_VIEW_TABS = [
  { value: "bracket", label: "Bracket" },
  // "Vote", not "Match": the badge beside it counts votes this reader still
  // owes, which the word "Match" leaves them to infer.
  { value: "match", label: "Vote" },
] as const;

export type ArenaViewTab = (typeof ALL_ARENA_VIEW_TABS)[number]["value"];

/** Both tabs, always: a finished tournament keeps Match because that is
 *  where its winner is shown, and a pane that disappears on the last vote
 *  would take the result with it. */
export function arenaViewTabs(_status: TournamentView["status"]): Array<{ value: ArenaViewTab; label: string }> {
  return [...ALL_ARENA_VIEW_TABS];
}

export function votableDuels(duels: Duel[]): Duel[] {
  return duels.filter(needsVote);
}

/** Every bracket position in round order, including the ones a later round
 *  hasn't filled yet — those keep a key so the list doesn't reshuffle when a
 *  winner finally lands in one. */
export function bracketSlots(bracketSize: number, duels: Duel[]): Array<{ key: string; duel: Duel | null }> {
  return bracketShape(bracketSize, duels).flatMap((round, roundIndex) =>
    round.map((duel, duelIndex) => ({ duel, key: `${roundIndex}:${duelIndex}` })));
}

/** The book that won the final, read off that duel rather than the
 *  summary's own `winner` field — that one has been seen already set while
 *  earlier rounds were still open. */
export function tournamentChampion(bracketSize: number, duels: Duel[]): DuelSide | null {
  const lastRound = bracketShape(bracketSize, duels).at(-1);
  const final = lastRound?.length === 1 ? lastRound[0] : null;
  if (!final?.winnerKey) return null;
  return final.winnerKey === final.bookA.key ? final.bookA : final.bookB;
}

export function matchEmptyCopy(status: TournamentView["status"], hasDuels: boolean): { title: string; body: string } {
  if (status === "seeding") return { title: "Not started yet", body: "The first matches open once every slot is seeded." };
  if (status === "completed") return { title: "No matches", body: "Every match has been played." };
  if (!hasDuels) return { title: "No matches yet", body: "Pull to refresh for updates." };
  return { title: "All caught up", body: "Every open match already has your vote. The next round opens when this one closes." };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Named from the back of the draw, so the same round is "Quarters" in a
 *  16-book bracket and "Round 1" in an 8-book one. */
export function roundLabel(byRound: BracketSlot[][], roundIdx: number): string {
  const count = byRound[roundIdx]?.length ?? 0;
  if (count === 1) return "Final";
  if (count === 2) return "Semis";
  if (count === 4) return "Quarters";
  return `Round ${roundIdx + 1}`;
}

/** Where this round sits, how much of it is done, and when it closes — the
 *  three things the screen never said. Split in two because all of it on one
 *  line truncates at phone width.
 *
 *  A deadline more than a day out is given as a date: "2d 6h left" is a sum
 *  the reader has to turn back into a day before it means anything. Inside
 *  the last day the countdown is the useful form. */
export function roundHeadline(byRound: BracketSlot[][], roundIdx: number, now = Date.now()): { title: string; status: string } {
  const slots = byRound[roundIdx] ?? [];
  const name = roundLabel(byRound, roundIdx);
  const position = `Round ${roundIdx + 1} of ${byRound.length}`;
  const settled = slots.filter((duel) => duel?.status === "settled").length;
  const parts = [`${settled} of ${slots.length} settled`];
  const closesAt = slots.find((duel) => duel?.status === "active")?.closesAt;
  if (closesAt) parts.push(closesLabel(closesAt, now));
  return { title: name === position.split(" of ")[0] ? position : `${name} · ${position}`, status: parts.join(" · ") };
}

function closesLabel(closesAt: string, now: number): string {
  const closes = new Date(closesAt);
  const remainingMs = closes.getTime() - now;
  if (remainingMs > 86_400_000) return `Closes ${WEEKDAYS[closes.getDay()]} ${closes.getDate()} ${MONTHS[closes.getMonth()]}`;
  return countdownLabel(closesAt, now);
}

/** What a match's tally can't say on its own. A settled duel with nothing in
 *  it reads as a bug otherwise — and the record doesn't say whether the owner
 *  settled it early or it simply expired unvoted, so this says neither. */
export function matchNote(duel: Duel): string | null {
  if (duel.status === "tied_pending_tiebreak") return "Tiebreak needed";
  if (duel.status !== "settled") return null;
  return duel.bookA.votes + duel.bookB.votes === 0 ? "Settled · no votes" : "Settled";
}
