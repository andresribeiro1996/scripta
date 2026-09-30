import type { SeedEntry } from "./rankedWorks.js";

export function mergeSeedLists(portuguese: SeedEntry[], english: SeedEntry[], counts: { por: number; eng: number }): SeedEntry[] {
  const seen = new Set<string>();
  const take = (entries: SeedEntry[], limit: number) => {
    const kept: SeedEntry[] = [];
    for (const entry of entries) {
      if (kept.length >= limit) break;
      if (seen.has(entry.isbn)) continue;
      seen.add(entry.isbn);
      kept.push(entry);
    }
    return kept;
  };
  return [...take(portuguese, counts.por), ...take(english, counts.eng)];
}
