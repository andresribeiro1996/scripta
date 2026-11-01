import { bracketShape, countdownLabel, duelWinner, needsVote, roundLabel, type BracketSlot, type Duel, type DuelSide } from "@scripta/shared";
import { sharedT, type Locale } from "@scripta/shared/i18n";
import type { TournamentView } from "./api";
import { translatorFor, type MessageKey } from "../../i18n";

const ALL_ARENA_VIEW_TABS = [
  { value: "bracket", labelKey: "arena.tabBracket" },
  // "Vote", not "Match": the badge beside it counts votes this reader still
  // owes, which the word "Match" leaves them to infer.
  { value: "match", labelKey: "arena.tabVote" },
] as const satisfies readonly { value: string; labelKey: MessageKey }[];

export type ArenaViewTab = (typeof ALL_ARENA_VIEW_TABS)[number]["value"];

/** Both tabs, always: a finished tournament keeps Match because that is
 *  where its winner is shown, and a pane that disappears on the last vote
 *  would take the result with it. */
export function arenaViewTabs(_status: TournamentView["status"], locale: Locale): Array<{ value: ArenaViewTab; label: string }> {
  const t = translatorFor(locale);
  return ALL_ARENA_VIEW_TABS.map((option) => ({ value: option.value, label: t(option.labelKey) }));
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

export const BRACKET_MATCH_WIDTH = 216;

export function bracketMapLayout(rounds: BracketSlot[][], viewportWidth: number): { width: number; coverWidths: number[] } {
  const slotsPerSide = Math.max(1, ...rounds.slice(0, -1).map((slots) => Math.ceil(slots.length / 2)));
  return {
    width: Math.max(viewportWidth, slotsPerSide * (BRACKET_MATCH_WIDTH + 16)),
    coverWidths: rounds.map((_, index) => Math.min(48 + index * 8, 80)),
  };
}

/** The book that won the final, read off that duel rather than the
 *  summary's own `winner` field — that one has been seen already set while
 *  earlier rounds were still open. */
export function tournamentChampion(bracketSize: number, duels: Duel[]): DuelSide | null {
  const lastRound = bracketShape(bracketSize, duels).at(-1);
  const final = lastRound?.length === 1 ? lastRound[0] : null;
  return final ? duelWinner(final) : null;
}

export function matchEmptyCopy(status: TournamentView["status"], hasDuels: boolean, locale: Locale): { title: string; body: string } {
  const t = translatorFor(locale);
  if (status === "seeding") return { title: t("arena.notStartedTitle"), body: t("arena.notStartedBody") };
  if (status === "completed") return { title: t("arena.noMatchesTitle"), body: t("arena.noMatchesBody") };
  if (!hasDuels) return { title: t("arena.noMatchesYetTitle"), body: t("arena.pullToRefresh") };
  return { title: t("arena.allCaughtUpTitle"), body: t("arena.allCaughtUpBody") };
}

const WEEKDAYS = ["arena.weekday0", "arena.weekday1", "arena.weekday2", "arena.weekday3", "arena.weekday4", "arena.weekday5", "arena.weekday6"] as const satisfies readonly MessageKey[];
const MONTHS = ["arena.month0", "arena.month1", "arena.month2", "arena.month3", "arena.month4", "arena.month5", "arena.month6", "arena.month7", "arena.month8", "arena.month9", "arena.month10", "arena.month11"] as const satisfies readonly MessageKey[];

/** Where this round sits, how much of it is done, and when it closes — the
 *  three things the screen never said. Split in two because all of it on one
 *  line truncates at phone width.
 *
 *  A deadline more than a day out is given as a date: "2d 6h left" is a sum
 *  the reader has to turn back into a day before it means anything. Inside
 *  the last day the countdown is the useful form. */
export function roundHeadline(byRound: BracketSlot[][], roundIdx: number, locale: Locale, now = Date.now()): { title: string; status: string } {
  const t = translatorFor(locale);
  const slots = byRound[roundIdx] ?? [];
  const name = roundLabel(byRound[roundIdx]?.length ?? 0, roundIdx + 1, locale);
  const position = t("arena.roundOf", { round: roundIdx + 1, total: byRound.length });
  const settled = slots.filter((duel) => duel?.status === "settled").length;
  const parts = [t("arena.settledCount", { settled, total: slots.length })];
  const closesAt = slots.find((duel) => duel?.status === "active")?.closesAt;
  if (closesAt) parts.push(closesLabel(closesAt, locale, now));
  const numbered = name === sharedT(locale)("shared.arenaBracket.round", { number: roundIdx + 1 });
  return { title: numbered ? position : t("arena.roundTitle", { name, position }), status: parts.join(" · ") };
}

function closesLabel(closesAt: string, locale: Locale, now: number): string {
  const closes = new Date(closesAt);
  const remainingMs = closes.getTime() - now;
  if (remainingMs > 86_400_000) {
    const t = translatorFor(locale);
    return t("arena.closesOn", { weekday: t(WEEKDAYS[closes.getDay()]!), day: closes.getDate(), month: t(MONTHS[closes.getMonth()]!) });
  }
  return countdownLabel(closesAt, locale, now);
}

export function matchHeading(duel: Duel, locale: Locale): string {
  const t = translatorFor(locale);
  const status = duel.status === "active" ? countdownLabel(duel.closesAt, locale) : duel.status === "tied_pending_tiebreak" ? t("arena.ownerTiebreakNeeded") : t("arena.settled");
  return t("arena.matchHeading", { round: duel.roundNumber, match: duel.duelIndex + 1, status });
}

/** What a match's tally can't say on its own. A settled duel with nothing in
 *  it reads as a bug otherwise — and the record doesn't say whether the owner
 *  settled it early or it simply expired unvoted, so this says neither. */
export function matchNote(duel: Duel, locale: Locale): string | null {
  const t = translatorFor(locale);
  if (duel.status === "tied_pending_tiebreak") return t("arena.tiebreakNeeded");
  if (duel.status !== "settled") return null;
  return t(duel.bookA.votes + duel.bookB.votes === 0 ? "arena.settledNoVotes" : "arena.settled");
}
