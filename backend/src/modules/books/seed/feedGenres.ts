import { BOOK_GENRES, canonicalIsbn, normalizeBookGenres, type BookGenre } from "@scripta/shared";
import { SourceUnavailableError } from "../domain/errors.js";
import type { BooksRepository } from "../domain/ports.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { PublisherSite } from "./publishers.js";

const CHUNK = 250;
const CENSUS_SIZE = 200;
const AGE = "(?:[1-9]|1[0-2])";
const FEED_LABEL_GENRES: Array<[BookGenre, RegExp]> = [
  ["Children's", new RegExp(`^\\+?\\s*${AGE}(?:\\s*-\\s*${AGE})?\\s*anos$`)]
];

export interface GenreFillSiteReport {
  products: number;
  matched: number;
  labelled: number;
  editions: number;
  skipped?: string;
}

export interface GenreFillReport {
  sites: Record<string, GenreFillSiteReport>;
  unmatchedLabels: Array<[string, number]>;
  matchedLabels: Array<[string, string, number]>;
}

export function feedLabelGenres(labels: string[]): BookGenre[] {
  const found = new Set<BookGenre>();
  const rest: string[] = [];
  for (const label of labels) {
    const rule = FEED_LABEL_GENRES.find(([, pattern]) => pattern.test(label.trim().toLowerCase()));
    if (rule) found.add(rule[0]);
    else rest.push(label);
  }
  for (const genre of normalizeBookGenres(rest)) found.add(genre);
  return BOOK_GENRES.filter((genre) => found.has(genre));
}

export async function fillFeedGenres(
  deps: {
    fetchText: ImportDeps["fetchText"];
    sleep: (ms: number) => Promise<void>;
    repo: Pick<BooksRepository, "listPublisherUrls" | "findBooksByKeys" | "countEmptyGenreEditions" | "fillSourceGenres" | "transaction">;
  },
  sites: PublisherSite[],
  options: { dryRun: boolean }
): Promise<GenreFillReport> {
  const byUrl = new Map<string, Set<string>>();
  for (const row of deps.repo.listPublisherUrls()) {
    if (row.work_id) byUrl.set(row.publisher_url, (byUrl.get(row.publisher_url) ?? new Set()).add(row.work_id));
  }
  const unmatched = new Map<string, number>();
  const matched = new Map<string, number>();
  const counted = new Set<string>();
  const reports: Record<string, GenreFillSiteReport> = {};
  for (const site of sites) {
    const report: GenreFillSiteReport = { products: 0, matched: 0, labelled: 0, editions: 0 };
    reports[site.name] = report;
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      report.products = feed.products;
      const isbnKey = (isbn: string) => `isbn:${canonicalIsbn(isbn)}`;
      const byIsbn = deps.repo.findBooksByKeys(feed.books.flatMap((book) => (book.isbn ? [isbnKey(book.isbn)] : [])));
      for (let start = 0; start < feed.books.length; start += CHUNK) {
        deps.repo.transaction(() => {
          for (const book of feed.books.slice(start, start + CHUNK)) {
            for (const label of book.labels) {
              const census = feedLabelGenres([label]).length === 0 ? unmatched : matched;
              census.set(label, (census.get(label) ?? 0) + 1);
            }
            const byIsbnWork = book.isbn ? byIsbn.get(isbnKey(book.isbn))?.work_id : undefined;
            const workIds = byUrl.get(book.productUrl) ?? new Set(byIsbnWork ? [byIsbnWork] : []);
            if (workIds.size === 0) continue;
            report.matched += 1;
            const genres = feedLabelGenres(book.labels);
            if (genres.length === 0) continue;
            for (const workId of workIds) {
              if (options.dryRun) {
                if (counted.has(workId)) continue;
                const empty = deps.repo.countEmptyGenreEditions(workId);
                if (empty > 0) {
                  counted.add(workId);
                  report.labelled += 1;
                  report.editions += empty;
                }
                continue;
              }
              const changed = deps.repo.fillSourceGenres(workId, genres);
              if (changed > 0) {
                report.labelled += 1;
                report.editions += changed;
              }
            }
          }
        });
      }
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      report.skipped = error.message;
    }
  }
  const unmatchedLabels = [...unmatched].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, CENSUS_SIZE);
  const matchedLabels = [...matched]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CENSUS_SIZE)
    .map(([label, count]): [string, string, number] => [label, feedLabelGenres([label]).join(", "), count]);
  return { sites: reports, unmatchedLabels, matchedLabels };
}
