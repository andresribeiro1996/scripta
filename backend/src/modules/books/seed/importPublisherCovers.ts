import { storeCoverImage } from "../booksService.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { encodeCover, isAcceptableCover } from "../domain/images.js";
import type { BooksRepository, CoverBlobStore } from "../domain/ports.js";
import { feedProducts, feedUrl, isDisallowed, parseRobots, parseShopifyProducts, parseWooProducts, type PublisherBook } from "./publisherFeed.js";
import type { PublisherSite } from "./publishers.js";
import { seedBook } from "./seedCatalog.js";

const MIN_WAIT_MS = 3000;
const MAX_PAGES = 200;

export interface SiteReport {
  skipped?: string;
  imageUrlPrefix?: string;
  products: number;
  books: number;
  coversSet: number;
  created: number;
  noAuthor: number;
  unchanged: number;
  rejectedImage: number;
  failed: number;
}

export interface ImportDeps {
  fetchText(url: string): Promise<{ status: number; text: string }>;
  fetchBytes(url: string): Promise<Buffer | null>;
  lookupOpenLibrary(isbn: string): Promise<{ title: string; author: string } | null>;
  repo: Pick<BooksRepository, "findBookByKey" | "createBook" | "getImage" | "insertImage" | "setCover" | "listRejectedUrls" | "setUpgradeWanted">;
  blobs: CoverBlobStore;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

class SiteSkipped extends Error {}

const emptyReport = (): SiteReport => ({ products: 0, books: 0, coversSet: 0, created: 0, noAuthor: 0, unchanged: 0, rejectedImage: 0, failed: 0 });

function commonPrefix(urls: string[]): string {
  let prefix = urls[0] ?? "";
  for (const url of urls) {
    let length = 0;
    while (length < prefix.length && prefix[length] === url[length]) length++;
    prefix = prefix.slice(0, length);
  }
  return prefix.slice(0, prefix.lastIndexOf("/") + 1);
}

async function importSite(site: PublisherSite, deps: ImportDeps, options: { dryRun: boolean }): Promise<SiteReport> {
  const report = emptyReport();
  let waitMs = MIN_WAIT_MS;
  let requested = false;
  const request = async <T>(call: () => Promise<T>): Promise<T> => {
    if (requested) await deps.sleep(waitMs);
    requested = true;
    return call();
  };

  const books: PublisherBook[] = [];
  try {
    const robots = await request(() => deps.fetchText(`${site.origin}/robots.txt`));
    if (robots.status !== 200) throw new SiteSkipped(`robots.txt answered HTTP ${robots.status}`);
    const rules = parseRobots(robots.text);
    if (isDisallowed(new URL(feedUrl(site, 1)).pathname, rules.disallow)) throw new SiteSkipped("robots.txt disallows the feed");
    waitMs = Math.max(MIN_WAIT_MS, rules.crawlDelayMs ?? 0);
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new SiteSkipped("feed has no end");
      const response = await request(() => deps.fetchText(feedUrl(site, page)));
      if (response.status === 400 && page > 1) break;
      if (response.status !== 200) throw new SiteSkipped(`feed answered HTTP ${response.status}`);
      let json: unknown;
      try {
        json = JSON.parse(response.text);
      } catch (error) {
        if (error instanceof SyntaxError) throw new SiteSkipped("feed is not JSON");
        throw error;
      }
      const products = feedProducts(json, site);
      if (!products) throw new SiteSkipped("feed is not a product list");
      if (products.length === 0) break;
      report.products += products.length;
      books.push(...(site.platform === "shopify" ? parseShopifyProducts(json, site) : parseWooProducts(json, site)));
    }
  } catch (error) {
    if (error instanceof SiteSkipped || error instanceof SourceUnavailableError) return { ...emptyReport(), skipped: error.message };
    throw error;
  }

  const seen = new Set<string>();
  const unique = books.filter((book) => !seen.has(book.isbn) && seen.add(book.isbn));
  report.books = unique.length;
  if (unique.length > 0) report.imageUrlPrefix = commonPrefix(unique.map((book) => book.imageUrl));

  for (const book of unique) {
    let row = deps.repo.findBookByKey(`isbn:${book.isbn}`);
    if (!row) {
      let { title, author } = book;
      if (!author) {
        let found: { title: string; author: string } | null;
        try {
          found = await deps.lookupOpenLibrary(book.isbn);
        } catch (error) {
          if (!(error instanceof SourceUnavailableError)) throw error;
          report.failed++;
          continue;
        }
        if (!found) {
          report.noAuthor++;
          continue;
        }
        ({ title, author } = found);
      }
      report.created++;
      if (options.dryRun) {
        report.coversSet++;
        continue;
      }
      row = seedBook({ isbn: book.isbn, title, author }, deps.repo, deps.now).book!;
    }

    const current = row.cover_image_id ? deps.repo.getImage(row.cover_image_id) : undefined;
    if (current?.source === "upload" || current?.source_url === book.imageUrl) {
      report.unchanged++;
      continue;
    }
    if (deps.repo.listRejectedUrls(row.id).has(book.imageUrl)) {
      report.rejectedImage++;
      continue;
    }
    if (options.dryRun) {
      report.coversSet++;
      continue;
    }
    let bytes: Buffer | null;
    try {
      bytes = await request(() => deps.fetchBytes(book.imageUrl));
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      report.failed++;
      continue;
    }
    const image = bytes && (await encodeCover(bytes));
    if (!image || !isAcceptableCover("publisher", image.width, image.height)) {
      report.rejectedImage++;
      continue;
    }
    if (image.width < MIN_GOOD_WIDTH && row.cover_image_id) {
      report.unchanged++;
      continue;
    }
    const at = deps.now().toISOString();
    const imageId = await storeCoverImage(deps, row.id, "publisher", book.imageUrl, image, at);
    deps.repo.setCover(row.id, { imageId, status: "manual", checkedAt: at });
    deps.repo.setUpgradeWanted(row.id, null);
    report.coversSet++;
  }
  return report;
}

export async function importPublisherCovers(deps: ImportDeps, sites: PublisherSite[], options: { dryRun: boolean }): Promise<Record<string, SiteReport>> {
  const reports = await Promise.all(
    sites.map(async (site) => {
      const report = await importSite(site, deps, options);
      deps.log(`${site.name} ${JSON.stringify(report)}`);
      return [site.name, report] as const;
    })
  );
  return Object.fromEntries(reports);
}
