import { roundLabel } from "../arena/arenaBracket.js";
import { FINISH_FEELINGS } from "../library/finish.js";

export const BOOK_STATS_MINIMUM = 3;
const TIER_LETTERS = ["S", "A", "B", "C", "D"] as const;
export type TierLetter = (typeof TIER_LETTERS)[number];
export type CommunityRating = { average: number; count: number; distribution: [number, number, number, number, number] };
export type TierStanding = { score: number; letter: TierLetter; lists: number; ballots: number };
export type TournamentRecord = { entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null };
export type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
type StripKey = "openLibrary" | "community" | "tiers" | "tournaments";

const scaled = (n: number, unit: number, suffix: string) => `${Math.round((n / unit) * 10) / 10}${suffix}`;
const compactCount = (n: number) => (n < 1000 ? String(n) : n < 999_950 ? scaled(n, 1000, "K") : scaled(n, 1_000_000, "M"));
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const feelingFor = (average: number) => FINISH_FEELINGS.find((feeling) => feeling.rating === Math.round(average))!.label as string;

export function tierLetter(score: number): TierLetter {
  return TIER_LETTERS[Math.min(4, Math.floor(score * 5))]!;
}

function bestFinish(record: TournamentRecord): string | null {
  if (record.titles > 0) return "Winner";
  return record.best ? roundLabel(record.best.duels, record.best.round) : null;
}

export function bookStatsModel(stats: BookStats | null, openLibrary: { value: number; count: number } | null) {
  const community = stats?.community ?? null;
  const tiers = stats?.tiers ?? null;
  const tournaments = stats?.tournaments ?? null;
  const strip: Array<{ key: StripKey; value: string; label: string }> = [];
  if (openLibrary) strip.push({ key: "openLibrary", value: `★ ${openLibrary.value.toFixed(1)}`, label: "Open Library" });
  if (community) strip.push({ key: "community", value: feelingFor(community.average), label: plural(community.count, "reader", "readers") });
  if (tiers) strip.push({ key: "tiers", value: `${tiers.letter} tier`, label: plural(tiers.lists, "list", "lists") });
  if (tournaments) {
    const best = bestFinish(tournaments);
    strip.push({ key: "tournaments", value: tournaments.titles > 0 ? plural(tournaments.titles, "title", "titles") : best ?? `${tournaments.wins}–${tournaments.losses}`, label: plural(tournaments.entered, "tournament", "tournaments") });
  }
  const largest = community ? Math.max(...community.distribution) : 0;
  return {
    strip,
    ratings: {
      openLibrary: openLibrary ? `★ ${openLibrary.value.toFixed(1)} · ${compactCount(openLibrary.count)} ${openLibrary.count === 1 ? "rating" : "ratings"} on Open Library` : null,
      community: community ? {
        feeling: feelingFor(community.average),
        summary: `${community.average.toFixed(1)} average · ${plural(community.count, "rating", "ratings")}`,
        bars: [...FINISH_FEELINGS].reverse().map((feeling) => {
          const count = community.distribution[feeling.rating - 1]!;
          return { label: feeling.label as string, count, fraction: largest > 0 ? count / largest : 0 };
        })
      } : null,
      empty: community ? null : `Shown once ${BOOK_STATS_MINIMUM} readers have rated it.`
    },
    tiers: tiers ? { letter: tiers.letter, summary: `Average across ${plural(tiers.lists, "published tier list", "published tier lists")} · ${plural(tiers.ballots, "vote", "votes")}` } : null,
    tiersEmpty: tiers ? null : `Shown once ${BOOK_STATS_MINIMUM} people have voted on it in tier lists.`,
    tournaments: tournaments ? [
      { label: "Entered", value: String(tournaments.entered) },
      { label: "Titles", value: String(tournaments.titles) },
      { label: "Won–lost", value: `${tournaments.wins}–${tournaments.losses}` },
      { label: "Best finish", value: bestFinish(tournaments) ?? "Not played yet" }
    ] : null,
    tournamentsEmpty: tournaments ? null : "Not in any tournament yet."
  };
}

export type BookStatsModel = ReturnType<typeof bookStatsModel>;
