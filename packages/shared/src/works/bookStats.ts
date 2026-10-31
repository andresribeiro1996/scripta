import { roundLabel } from "../arena/arenaBracket.js";
import type { Locale } from "../i18n/locale.js";
import { decimalText } from "../i18n/numbers.js";
import { sharedT } from "../i18n/sharedT.js";
import { finishFeelings } from "../library/finish.js";

export const BOOK_STATS_MINIMUM = 3;
const TIER_LETTERS = ["S", "A", "B", "C", "D"] as const;
export type TierLetter = (typeof TIER_LETTERS)[number];
export type CommunityRating = { average: number; count: number; distribution: [number, number, number, number, number] };
export type TierStanding = { score: number; letter: TierLetter; lists: number; ballots: number };
export type TournamentRecord = { entered: number; titles: number; wins: number; losses: number; best: { round: number; duels: number } | null };
export type BookStats = { community: CommunityRating | null; tiers: TierStanding | null; tournaments: TournamentRecord | null };
type TileKey = "community" | "tiers" | "tournaments";

const scaled = (n: number, unit: number, locale: Locale) => decimalText(Math.round((n / unit) * 10) / 10, locale);
const compactCount = (n: number, locale: Locale) => (n < 1000 ? String(n) : n < 999_950 ? sharedT(locale)("shared.bookStats.thousands", { value: scaled(n, 1000, locale) }) : sharedT(locale)("shared.bookStats.millions", { value: scaled(n, 1_000_000, locale) }));
export const ratingCountLabel = (count: number, locale: Locale) => sharedT(locale)("shared.bookStats.ratingCount", { count, compact: compactCount(count, locale) });
const feelingFor = (average: number, locale: Locale) => finishFeelings(locale).find((feeling) => feeling.rating === Math.round(average))!.label;

export function tierPosition({ tierIndex, tierCount, ranksWorstFirst }: { tierIndex: number; tierCount: number; ranksWorstFirst: boolean }): number | null {
  if (tierCount < 2) return null;
  const position = tierIndex / (tierCount - 1);
  return ranksWorstFirst ? 1 - position : position;
}

export function tierLetter(score: number): TierLetter {
  return TIER_LETTERS[Math.min(4, Math.floor(score * 5))]!;
}

const BAND_KEYS = ["shared.bookStats.band0", "shared.bookStats.band1", "shared.bookStats.band2", "shared.bookStats.band3", "shared.bookStats.band4"] as const;
const TILE_VALUE_KEYS = ["shared.bookStats.tileValue0", "shared.bookStats.tileValue1", "shared.bookStats.tileValue2", "shared.bookStats.tileValue3", "shared.bookStats.tileValue4"] as const;
const TILE_CAPTION_KEYS = ["shared.bookStats.tileCaption0", "shared.bookStats.tileCaption1", "shared.bookStats.tileCaption2", "shared.bookStats.tileCaption3", "shared.bookStats.tileCaption4"] as const;

const bandIndex = (score: number) => Math.min(4, Math.floor(score * 5));

export function tierBand(score: number, locale: Locale): string {
  return sharedT(locale)(BAND_KEYS[bandIndex(score)]!);
}

function tierTile(score: number, lists: number, locale: Locale) {
  const t = sharedT(locale);
  const index = bandIndex(score);
  return { value: t(TILE_VALUE_KEYS[index]!), caption: t(TILE_CAPTION_KEYS[index]!, { lists: t("shared.bookStats.lists", { count: lists }) }) };
}

function tournamentPath(record: TournamentRecord, locale: Locale) {
  const { best } = record;
  if (!best) return [];
  const finalRound = best.round + Math.log2(best.duels);
  return Array.from({ length: finalRound }, (_, index) => {
    const round = index + 1;
    return { label: roundLabel(2 ** (finalRound - round), round, locale), reached: round <= best.round };
  });
}

function bestFinish(record: TournamentRecord, locale: Locale): string | null {
  if (record.titles > 0) return sharedT(locale)("shared.bookStats.winner");
  return record.best ? roundLabel(record.best.duels, record.best.round, locale) : null;
}

export function bookStatsModel(stats: BookStats | null, openLibrary: { value: number; count: number } | null, locale: Locale) {
  const t = sharedT(locale);
  const community = stats?.community ?? null;
  const tiers = stats?.tiers ?? null;
  const tournaments = stats?.tournaments ?? null;
  const rounded = community ? Math.round(community.average * 10) / 10 : 0;
  const tiles: Array<{ key: TileKey; value: string; caption: string }> = [];
  if (community) tiles.push({ key: "community", value: decimalText(rounded, locale, 1), caption: feelingFor(rounded, locale) });
  if (tiers) tiles.push({ key: "tiers", ...tierTile(tiers.score, tiers.lists, locale) });
  if (tournaments) tiles.push({ key: "tournaments", value: "🏆", caption: bestFinish(tournaments, locale) ?? t("shared.bookStats.entered") });
  const largest = community ? Math.max(...community.distribution) : 0;
  return {
    tiles,
    ratings: {
      openLibrary: openLibrary ? t("shared.bookStats.openLibrary", { value: decimalText(openLibrary.value, locale, 1), ratings: ratingCountLabel(openLibrary.count, locale) }) : null,
      community: community ? {
        feeling: feelingFor(rounded, locale),
        summary: t("shared.bookStats.communitySummary", { average: decimalText(rounded, locale, 1), ratings: t("shared.bookStats.ratings", { count: community.count }) }),
        columns: finishFeelings(locale).map((feeling) => {
          const count = community.distribution[feeling.rating - 1]!;
          return { label: feeling.label, count, fraction: largest > 0 ? count / largest : 0, top: largest > 0 && count === largest };
        })
      } : null,
      empty: community ? null : t("shared.bookStats.communityEmpty", { count: BOOK_STATS_MINIMUM })
    },
    tierBar: tiers ? { band: tierBand(tiers.score, locale), marker: tiers.score, summary: t("shared.bookStats.tierSummary", { lists: t("shared.bookStats.publishedLists", { count: tiers.lists }), votes: t("shared.bookStats.votes", { count: tiers.ballots }) }) } : null,
    tournamentRun: tournaments ? { path: tournamentPath(tournaments, locale), champion: tournaments.titles > 0, summary: t("shared.bookStats.tournamentSummary", { tournaments: t("shared.bookStats.tournaments", { count: tournaments.entered }), wins: tournaments.wins, losses: tournaments.losses, titles: t("shared.bookStats.titles", { count: tournaments.titles }) }) } : null,
    tiersEmpty: tiers ? null : t("shared.bookStats.tiersEmpty", { count: BOOK_STATS_MINIMUM }),
    tournamentsEmpty: tournaments ? null : t("shared.bookStats.tournamentsEmpty")
  };
}

export type BookStatsModel = ReturnType<typeof bookStatsModel>;
