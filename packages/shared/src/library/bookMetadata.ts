// The cross-client half of frontend's lib/bookMetadata.ts: the
// BookMetadata shape and the rating validator both the detail sheet and
// (eventually) mobile need. The actual Open Library fetch and the
// TanStack Query `queryOptions` wrapper are framework/network-bound —
// they stay in frontend/src/lib/bookMetadata.ts (and their own future
// mobile equivalent), not here.

export interface BookMetadata {
  summary: string | null;
  rating: number | null;
  ratingCount: number;
  sourceUrl: string;
}

export function validBookRating(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5 ? value : null;
}
