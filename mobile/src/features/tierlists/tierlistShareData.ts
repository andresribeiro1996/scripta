import { aggregate, type AggregationMode, type HistogramCell, type TierlistData } from "@scripta/shared";

export function shareableCommunityResults(histogram: HistogramCell[] | null, ballotCount: number) {
  return histogram !== null && ballotCount > 0;
}

export function tierlistShareRows(data: TierlistData, histogram?: HistogramCell[], mode: AggregationMode = "average") {
  if (!histogram) return { tiers: data.tiers, extra: data.pool };
  const results = aggregate(histogram, data.tiers.map((tier) => tier.id), data.pool, mode);
  return {
    tiers: data.tiers.map((tier) => ({ ...tier, bookKeys: results.filter((result) => result.tierId === tier.id).map((result) => result.bookKey) })),
    extra: results.filter((result) => result.tierId === null).map((result) => result.bookKey),
  };
}
