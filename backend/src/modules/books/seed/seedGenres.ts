import { canonicalIsbn, normalizeBookGenres } from "@scripta/shared";
import { normalizeWorkKey } from "../domain/normalize.js";
import type { BooksRepository } from "../domain/ports.js";
import type { SeedEntry } from "./rankedWorks.js";

const CHUNK = 1000;

export type SeedGenresReport = { fetched: number; matched: number; labelled: number; editions: number; noGenre: number; unmatched: number };

const isbnKey = (entry: SeedEntry) => `isbn:${canonicalIsbn(entry.isbn)}`;

export function fillSeedGenres(
  entries: SeedEntry[],
  repo: Pick<BooksRepository, "workIdsByWorkKeys" | "findBooksByKeys" | "countEmptyGenreEditions" | "fillSourceGenres" | "transaction">,
  options: { dryRun: boolean }
): SeedGenresReport {
  const report: SeedGenresReport = { fetched: entries.length, matched: 0, labelled: 0, editions: 0, noGenre: 0, unmatched: 0 };
  const seen = new Set<string>();
  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const byWorkKey = repo.workIdsByWorkKeys(chunk.flatMap((entry) => normalizeWorkKey(entry.workKey) ?? []));
    const byIsbn = repo.findBooksByKeys(chunk.map(isbnKey));
    repo.transaction(() => {
      for (const entry of chunk) {
        const key = normalizeWorkKey(entry.workKey);
        const workId = (key ? byWorkKey.get(key) : undefined) ?? byIsbn.get(isbnKey(entry))?.work_id ?? null;
        if (!workId) {
          report.unmatched += 1;
          continue;
        }
        if (seen.has(workId)) continue;
        seen.add(workId);
        report.matched += 1;
        const genres = normalizeBookGenres(entry.subjects);
        if (genres.length === 0) {
          report.noGenre += 1;
          continue;
        }
        if (options.dryRun) {
          const empty = repo.countEmptyGenreEditions(workId);
          if (empty > 0) {
            report.labelled += 1;
            report.editions += empty;
          }
          continue;
        }
        const changed = repo.fillSourceGenres(workId, genres);
        if (changed > 0) {
          report.labelled += 1;
          report.editions += changed;
        }
      }
    });
  }
  return report;
}
