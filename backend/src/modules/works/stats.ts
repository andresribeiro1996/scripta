import { BOOK_STATS_MINIMUM, tierLetter, type BookStats, type CommunityRating, type TierStanding, type TournamentRecord } from "@scripta/shared";

export type BookStatsDeps = {
  getWorkPage(id: string): { aliasIds: string[] } | undefined;
  communityRatings(workIds: string[]): Array<{ userId: string; rating: number }>;
  tierPlacements(workIds: string[]): Array<{ tierlistId: string; tierIndex: number; tierCount: number; ranksWorstFirst: boolean }>;
  tournamentRecord(workIds: string[]): TournamentRecord;
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function community(ratings: Array<{ rating: number }>): CommunityRating | null {
  if (ratings.length < BOOK_STATS_MINIMUM) return null;
  const distribution: CommunityRating["distribution"] = [0, 0, 0, 0, 0];
  for (const { rating } of ratings) distribution[rating - 1]! += 1;
  return { average: mean(ratings.map((r) => r.rating)), count: ratings.length, distribution };
}

function tiers(placements: Array<{ tierlistId: string; tierIndex: number; tierCount: number; ranksWorstFirst: boolean }>): TierStanding | null {
  const byList = new Map<string, number[]>();
  for (const placement of placements) {
    if (placement.tierCount < 2) continue;
    const position = placement.tierIndex / (placement.tierCount - 1);
    byList.set(placement.tierlistId, [...(byList.get(placement.tierlistId) ?? []), placement.ranksWorstFirst ? 1 - position : position]);
  }
  const ballots = [...byList.values()].reduce((sum, positions) => sum + positions.length, 0);
  if (ballots < BOOK_STATS_MINIMUM) return null;
  const score = mean([...byList.values()].map(mean));
  return { score, letter: tierLetter(score), lists: byList.size, ballots };
}

export function createBookStatsService(deps: BookStatsDeps) {
  return {
    getStats(id: string): BookStats | undefined {
      const work = deps.getWorkPage(id);
      if (!work) return undefined;
      const record = deps.tournamentRecord(work.aliasIds);
      return {
        community: community(deps.communityRatings(work.aliasIds)),
        tiers: tiers(deps.tierPlacements(work.aliasIds)),
        tournaments: record.entered > 0 ? record : null
      };
    }
  };
}

export type BookStatsService = ReturnType<typeof createBookStatsService>;
