import { findBestCover, type CoverSources, type FetchCoverImage } from "../coverResolver.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import type { SeedEntry, SeedLanguage } from "./rankedWorks.js";

export interface TrialRow {
  isbn: string;
  lang: SeedLanguage;
  free: { source: string; width: number } | null;
  isbndb: { width: number } | null;
}

export interface LangSummary {
  books: number;
  freeGood: number;
  isbndbGood: number;
  gapFills: number;
  isbndbWider: number;
  noCover: number;
}

export interface TrialSummary {
  byLang: Record<SeedLanguage, LangSummary>;
  projectedGapFills: number;
}

export async function trialBook(entry: SeedEntry, freeSources: CoverSources, isbndbOnly: CoverSources, fetchImage: FetchCoverImage): Promise<TrialRow | null> {
  const book = { isbn: entry.isbn, title: entry.title, author: entry.author };
  const [free, isbndb] = await Promise.all([
    findBestCover(book, new Set(), freeSources, fetchImage),
    findBestCover(book, new Set(), isbndbOnly, fetchImage)
  ]);
  if (!free.complete || !isbndb.complete) return null;
  return {
    isbn: entry.isbn,
    lang: entry.lang,
    free: free.found ? { source: free.found.candidate.source, width: free.found.image.width } : null,
    isbndb: isbndb.found ? { width: isbndb.found.image.width } : null
  };
}

export function pendingEntries(entries: SeedEntry[], recorded: Set<string>): SeedEntry[] {
  return entries.filter((entry) => !recorded.has(entry.isbn));
}

const empty = (): LangSummary => ({ books: 0, freeGood: 0, isbndbGood: 0, gapFills: 0, isbndbWider: 0, noCover: 0 });

export function summarizeTrial(rows: TrialRow[], seedCounts: { eng: number; por: number }): TrialSummary {
  const byLang: Record<SeedLanguage, LangSummary> = { eng: empty(), por: empty() };
  for (const row of rows) {
    const s = byLang[row.lang];
    const freeGood = (row.free?.width ?? 0) >= MIN_GOOD_WIDTH;
    const isbndbGood = (row.isbndb?.width ?? 0) >= MIN_GOOD_WIDTH;
    s.books++;
    if (freeGood) s.freeGood++;
    if (isbndbGood) s.isbndbGood++;
    if (!freeGood && isbndbGood) s.gapFills++;
    if (row.free && row.isbndb && row.isbndb.width > row.free.width) s.isbndbWider++;
    if (!row.free && !row.isbndb) s.noCover++;
  }
  const projectedGapFills = (["eng", "por"] as const).reduce((sum, lang) => sum + (byLang[lang].books ? (byLang[lang].gapFills / byLang[lang].books) * seedCounts[lang] : 0), 0);
  return { byLang, projectedGapFills: Math.round(projectedGapFills) };
}
