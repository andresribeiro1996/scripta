import { normalizeWords } from "./normalize.js";

export type SeriesSource = "wikidata" | "ol-edition" | "ol-subject" | "original-title";
export type CollectionSource = "bnp" | "ol-edition";
export type SeriesEntry = { name: string; position: string | null };

export const SERIES_SOURCE_RANK: Record<SeriesSource, number> = { wikidata: 0, "ol-edition": 1, "ol-subject": 2, "original-title": 3 };

export function seriesNameKey(name: string): string | null {
  return normalizeWords(name) || null;
}
