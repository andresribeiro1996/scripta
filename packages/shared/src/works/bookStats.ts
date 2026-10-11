import { roundLabel } from "../arena/arenaBracket.js";
import { FINISH_FEELINGS } from "../library/finish.js";

export const BOOK_STATS_MINIMUM = 3;
const TIER_LETTERS = ["S", "A", "B", "C", "D"] as const;
export type TierLetter = (typeof TIER_LETTERS)[number];
export type CommunityRating = { average: number; count: number; distribution: [number, number, number, number, number] };
export type TierStanding = { score: number; letter: TierLetter; lists: number; ballots: number };
export type TournamentRecord = { entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null };
export type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
type TileKey = "openLibrary" | "community" | "tiers" | "tournaments";

const scaled = (n: number, unit: number, suffix: string) => `${Math.round((n / unit) * 10) / 10}${suffix}`;
const compactCount = (n: number) => (n < 1000 ? String(n) : n < 999_950 ? scaled(n, 1000, "K") : scaled(n, 1_000_000, "M"));
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const feelingFor = (average: number) => FINISH_FEELINGS.find((feeling) => feeling.rating === Math.round(average))!.label as string;

export function tierLetter(score: number): TierLetter {
  return TIER_LETTERS[Math.min(4, Math.floor(score * 5))]!;
}

const TIER_BANDS = ["Top tier", "Upper tiers", "Middle", "Lower tiers", "Bottom tier"] as const;
export type TierBand = (typeof TIER_BANDS)[number];

export function tierBand(score: number): TierBand {
  return TIER_BANDS[Math.min(4, Math.floor(score * 5))]!;
}

function tierTile(band: TierBand, lists: number) {
  const [value, ...rest] = band.split(" ");
  const listCount = plural(lists, "list", "lists");
  return { value: value!, caption: rest.length > 0 ? `${rest.join(" ")} · ${listCount}` : listCount };
}

function tournamentPath(record: TournamentRecord) {
  const { best } = record;
  if (!best) return [];
  const finalRound = best.round + Math.log2(best.duels);
  return Array.from({ length: finalRound }, (_, index) => {
    const round = index + 1;
    return { label: roundLabel(2 ** (finalRound - round), round), reached: round <= best.round };
  });
}

function bestFinish(record: TournamentRecord): string | null {
  if (record.titles > 0) return "Winner";
  return record.best ? roundLabel(record.best.duels, record.best.round) : null;
}

export function bookStatsModel(stats: BookStats | null, openLibrary: { value: number; count: number } | null) {
  const community = stats?.community ?? null;
  const tiers = stats?.tiers ?? null;
  const tournaments = stats?.tournaments ?? null;
  const rounded = community ? Math.round(community.average * 10) / 10 : 0;
  const tiles: Array<{ key: TileKey; value: string; caption: string }> = [];
  if (openLibrary) tiles.push({ key: "openLibrary", value: openLibrary.value.toFixed(1), caption: "★ Open Library" });
  if (community) tiles.push({ key: "community", value: rounded.toFixed(1), caption: feelingFor(rounded) });
  if (tiers) tiles.push({ key: "tiers", ...tierTile(tierBand(tiers.score), tiers.lists) });
  if (tournaments) tiles.push({ key: "tournaments", value: "🏆", caption: bestFinish(tournaments) ?? "Entered" });
  const largest = community ? Math.max(...community.distribution) : 0;
  return {
    tiles,
    ratings: {
      openLibrary: openLibrary ? `★ ${openLibrary.value.toFixed(1)} · ${compactCount(openLibrary.count)} ${openLibrary.count === 1 ? "rating" : "ratings"} on Open Library` : null,
      community: community ? {
        feeling: feelingFor(rounded),
        summary: `${rounded.toFixed(1)} average · ${plural(community.count, "rating", "ratings")}`,
        columns: FINISH_FEELINGS.map((feeling) => {
          const count = community.distribution[feeling.rating - 1]!;
          return { label: feeling.label as string, count, fraction: largest > 0 ? count / largest : 0, top: largest > 0 && count === largest };
        })
      } : null,
      empty: community ? null : `Shown once ${BOOK_STATS_MINIMUM} readers have rated it.`
    },
    tierBar: tiers ? { band: tierBand(tiers.score), marker: tiers.score, summary: `Across ${plural(tiers.lists, "published tier list", "published tier lists")} · ${plural(tiers.ballots, "vote", "votes")}` } : null,
    tournamentRun: tournaments ? { path: tournamentPath(tournaments), champion: tournaments.titles > 0, summary: `${plural(tournaments.entered, "tournament", "tournaments")} · ${tournaments.wins} won, ${tournaments.losses} lost · ${plural(tournaments.titles, "title", "titles")}` } : null,
    tiersEmpty: tiers ? null : `Shown once ${BOOK_STATS_MINIMUM} people have voted on it in tier lists.`,
    tournamentsEmpty: tournaments ? null : "Not in any tournament yet."
  };
}

export type BookStatsModel = ReturnType<typeof bookStatsModel>;
