import { SourceUnavailableError } from "../domain/errors.js";
import type { BooksRepository } from "../domain/ports.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { PublisherSite } from "./publishers.js";

export interface TitleFillSiteReport {
  products: number;
  matched: number;
  filled: number;
  skipped?: string;
}

export interface TitleFillReport {
  sites: Record<string, TitleFillSiteReport>;
  blankBefore: number;
  leftBlank: number;
}

export async function fillBlankTitles(
  deps: { fetchText: ImportDeps["fetchText"]; sleep: (ms: number) => Promise<void>; repo: Pick<BooksRepository, "listBlankTitled" | "fillIdentity"> },
  sites: PublisherSite[],
  options: { dryRun: boolean }
): Promise<TitleFillReport> {
  const blank = new Map<string, string[]>();
  let blankBefore = 0;
  for (const row of deps.repo.listBlankTitled()) {
    blank.set(row.publisher_url, [...(blank.get(row.publisher_url) ?? []), row.id]);
    blankBefore++;
  }
  const reports: Record<string, TitleFillSiteReport> = {};
  for (const site of sites) {
    const report: TitleFillSiteReport = { products: 0, matched: 0, filled: 0 };
    reports[site.name] = report;
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      report.products = feed.products;
      for (const book of feed.books) {
        const ids = blank.get(book.productUrl);
        if (!ids) continue;
        blank.delete(book.productUrl);
        report.matched += ids.length;
        if (options.dryRun) continue;
        for (const id of ids) deps.repo.fillIdentity(id, book.title, book.author ?? "");
        report.filled += ids.length;
      }
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      report.skipped = error.message;
    }
  }
  return { sites: reports, blankBefore, leftBlank: [...blank.values()].reduce((total, ids) => total + ids.length, 0) };
}
