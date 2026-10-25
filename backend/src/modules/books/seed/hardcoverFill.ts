import { canonicalIsbn, type BookGenre } from "@scripta/shared";
import { detectedLanguage } from "../adapters/catalog/languageFilter.js";
import { descriptionText, featuredSeriesOf, genresFromTags, HARDCOVER_PAGE_SIZE, seriesPosition, type HardcoverBook, type HardcoverLookup } from "../adapters/hardcover/hardcover.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { isPortugueseIsbn } from "../domain/normalize.js";
import type { BooksRepository } from "../domain/ports.js";
import { seriesNameKey } from "../domain/series.js";

const PROGRESS_EVERY = 20;
const GENRE_SAMPLES = 50;
const ENGLISH_ISBN = /^97(80|81|98)/;

export type HardcoverFillOptions = { dryRun: boolean; skipNameKeys: Set<string>; after: number; maxRequests: number | null };

export type HardcoverReport = {
  dryRun: boolean;
  requests: number;
  editions: number;
  matched: number;
  lastRowid: number;
  stoppedBy: "done" | "max-requests" | "daily-quota" | "error";
  error?: string;
  series: { added: number; skipped: number; works: number };
  descriptions: { added: number; descriptionWrongLanguage: number; alreadyHadSummary: number };
  genres: { works: number; editions: number; noMappedGenre: number };
  skippedBooks: number;
  duplicateIsbns: number;
  seriesNames?: Array<{ name: string; works: number }>;
  genreSamples?: Array<{ tags: string[]; genres: BookGenre[] }>;
};

type FillRepo = Pick<BooksRepository, "isbnPage" | "hasWorkSeries" | "addWorkSeries" | "mergeDetails" | "fillSourceGenres" | "countEmptyGenreEditions" | "canonicalWorkIds" | "transaction">;

export function editionLanguageOf(edition: { language: string | null; isbn: string }): "pt" | "en" | string | null {
  const tag = edition.language?.split("-")[0];
  if (tag) return tag;
  if (isPortugueseIsbn(edition.isbn)) return "pt";
  return ENGLISH_ISBN.test(canonicalIsbn(edition.isbn)) ? "en" : null;
}

export async function fillFromHardcover(
  deps: { repo: FillRepo; lookup: HardcoverLookup; now: () => Date; log: (line: string) => void },
  options: HardcoverFillOptions
): Promise<HardcoverReport> {
  const { repo, lookup, now, log } = deps;
  const report: HardcoverReport = {
    dryRun: options.dryRun,
    requests: 0,
    editions: 0,
    matched: 0,
    lastRowid: options.after,
    stoppedBy: "done",
    series: { added: 0, skipped: 0, works: 0 },
    descriptions: { added: 0, descriptionWrongLanguage: 0, alreadyHadSummary: 0 },
    genres: { works: 0, editions: 0, noMappedGenre: 0 },
    skippedBooks: 0,
    duplicateIsbns: 0
  };
  const seriesSeen = new Set<string>();
  const genresDone = new Set<string>();
  const seriesCount = new Map<string, { name: string; works: number }>();
  const genreSamples: Array<{ tags: string[]; genres: BookGenre[] }> = [];
  const atomically = <T>(write: () => T): T => (options.dryRun ? write() : repo.transaction(write));

  for (;;) {
    const page = repo.isbnPage(report.lastRowid, HARDCOVER_PAGE_SIZE);
    if (page.length === 0) break;
    if (options.maxRequests !== null && report.requests >= options.maxRequests) {
      report.stoppedBy = "max-requests";
      break;
    }
    const keyed = page.map((edition) => ({ edition, isbn: canonicalIsbn(edition.isbn) }));
    let returned;
    try {
      returned = await lookup([...new Set(keyed.map(({ isbn }) => isbn))]);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      report.stoppedBy = error.quota || error.status === 429 ? "daily-quota" : "error";
      report.error = error.message;
      break;
    }

    const books = new Map<string, HardcoverBook>();
    let skippedBooks = 0;
    let duplicateIsbns = 0;
    for (const { isbn13, book } of returned) {
      if (!book.usable) skippedBooks += 1;
      else if (isbn13 !== null && books.has(isbn13)) duplicateIsbns += 1;
      else if (isbn13 !== null) books.set(isbn13, book);
    }

    atomically(() => {
      const canonical = repo.canonicalWorkIds([...new Set(page.flatMap(({ workId }) => (workId === null ? [] : [workId])))]);
      for (const { edition, isbn } of keyed) {
        const book = books.get(isbn);
        if (!book) continue;
        report.matched += 1;

        const text = descriptionText(book.description);
        if (text !== null) {
          const detected = detectedLanguage(text);
          if (edition.hasSummary) report.descriptions.alreadyHadSummary += 1;
          else if (detected === null || detected !== editionLanguageOf(edition)) report.descriptions.descriptionWrongLanguage += 1;
          else {
            if (!options.dryRun) repo.mergeDetails(edition.id, { summary: text, pages: null, year: null, publisher: null, translator: null }, "hardcover");
            report.descriptions.added += 1;
          }
        }

        if (edition.workId === null) continue;
        const workId = canonical.get(edition.workId) ?? edition.workId;

        if (!seriesSeen.has(workId)) {
          seriesSeen.add(workId);
          const featured = featuredSeriesOf(book);
          if (featured !== null && !repo.hasWorkSeries(workId, "hardcover")) {
            const key = seriesNameKey(featured.name);
            if (key === null || options.skipNameKeys.has(key)) report.series.skipped += 1;
            else {
              if (!options.dryRun) repo.addWorkSeries(workId, [{ name: featured.name, position: seriesPosition(featured.position) }], "hardcover", now().toISOString());
              report.series.added += 1;
              const tally = seriesCount.get(key) ?? { name: featured.name, works: 0 };
              tally.works += 1;
              seriesCount.set(key, tally);
            }
          }
        }

        if (!genresDone.has(workId)) {
          const genres = genresFromTags(book.genreTags);
          if (genres.length === 0) report.genres.noMappedGenre += 1;
          else {
            const filled = options.dryRun ? repo.countEmptyGenreEditions(workId) : repo.fillSourceGenres(workId, genres);
            if (filled > 0) {
              report.genres.works += 1;
              report.genres.editions += filled;
            }
            genresDone.add(workId);
            if (options.dryRun && genreSamples.length < GENRE_SAMPLES) genreSamples.push({ tags: book.genreTags.map(({ tag }) => tag), genres });
          }
        }
      }
    });

    report.requests += 1;
    report.editions += page.length;
    report.skippedBooks += skippedBooks;
    report.duplicateIsbns += duplicateIsbns;
    report.lastRowid = page[page.length - 1]!.rowid;
    if (report.requests % PROGRESS_EVERY === 0) log(JSON.stringify({ requests: report.requests, lastRowid: report.lastRowid, matched: report.matched }));
  }

  report.series.works = report.series.added;
  report.seriesNames = [...seriesCount.values()].sort((left, right) => right.works - left.works || left.name.localeCompare(right.name));
  if (options.dryRun) report.genreSamples = genreSamples;
  return report;
}
