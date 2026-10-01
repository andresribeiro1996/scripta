import { storeCoverImage } from "../booksService.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { encodeCover, isAcceptableCover } from "../domain/images.js";
import { normalizeTitle } from "../domain/normalize.js";
import type { BooksRepository, CoverBlobStore } from "../domain/ports.js";
import type { BookRow } from "../domain/types.js";
import { PAGE_RANK, feedProducts, feedUrl, findPageIsbn, isDisallowed, parseRobots, parseShopifyProducts, parseWooProducts, type PublisherBook, type ResolvedBook } from "./publisherFeed.js";
import type { PublisherSite } from "./publishers.js";
import { seedBook } from "./seedCatalog.js";

const MIN_WAIT_MS = 3000;
const MAX_PAGES = 200;
const PAGE_PROGRESS_EVERY = 100;

export interface SiteReport {
  skipped?: string;
  imageUrlPrefix?: string;
  products: number;
  books: number;
  fromPage: number;
  pagesNoIsbn: number;
  pagesBlocked: number;
  pageTitleMismatch: number;
  coversSet: number;
  created: number;
  noAuthor: number;
  unchanged: number;
  rejectedImage: number;
  failed: number;
}

export interface OpenLibraryEdition {
  title: string | null;
  author: string;
  workKey?: string | null;
}

export interface ImportDeps {
  fetchText(url: string): Promise<{ status: number; text: string }>;
  fetchBytes(url: string): Promise<Buffer | null>;
  lookupOpenLibrary(isbn: string): Promise<OpenLibraryEdition | null>;
  repo: Pick<BooksRepository, "findBookByKey" | "getBook" | "createBook" | "addKey" | "fillIdentity" | "setWorkKey" | "getImage" | "insertImage" | "setCover" | "listRejectedUrls" | "setUpgradeWanted">;
  blobs: CoverBlobStore;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

class SiteSkipped extends Error {}

const emptyReport = (): SiteReport => ({ products: 0, books: 0, fromPage: 0, pagesNoIsbn: 0, pagesBlocked: 0, pageTitleMismatch: 0, coversSet: 0, created: 0, noAuthor: 0, unchanged: 0, rejectedImage: 0, failed: 0 });

function sameTitle(known: string, productTitle: string): boolean {
  const [short, long] = [normalizeTitle(known), normalizeTitle(productTitle)].sort((a, b) => a.length - b.length) as [string, string];
  return short !== "" && (short === long || (short.includes(" ") && long.startsWith(`${short} `)));
}

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
  let disallow: string[] = [];
  try {
    const robots = await request(() => deps.fetchText(`${site.origin}/robots.txt`));
    if (robots.status !== 200 && robots.status !== 404) throw new SiteSkipped(`robots.txt answered HTTP ${robots.status}`);
    const rules = robots.status === 200 ? parseRobots(robots.text) : { disallow: [], crawlDelayMs: null };
    const feed = new URL(feedUrl(site, 1));
    disallow = rules.disallow;
    if (isDisallowed(feed.pathname + feed.search, disallow)) throw new SiteSkipped("robots.txt disallows the feed");
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

  const resolved: ResolvedBook[] = [];
  const pagesTotal = books.filter((book) => !book.isbn).length;
  let pagesRequested = 0;
  for (const book of books) {
    if (book.isbn) {
      resolved.push({ ...book, isbn: book.isbn });
      continue;
    }
    const page = new URL(book.productUrl);
    if (isDisallowed(page.pathname + page.search, disallow)) continue;
    if (++pagesRequested % PAGE_PROGRESS_EVERY === 0) deps.log(`${site.name}: pages ${pagesRequested}/${pagesTotal}`);
    let response: { status: number; text: string };
    try {
      response = await request(() => deps.fetchText(book.productUrl));
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
      report.failed++;
      continue;
    }
    if (response.status === 404) continue;
    if (response.status !== 200) {
      report.pagesBlocked++;
      continue;
    }
    const isbn = findPageIsbn(response.text);
    if (isbn) resolved.push({ ...book, isbn });
    else report.pagesNoIsbn++;
  }

  const strongest = new Map<string, ResolvedBook>();
  for (const book of resolved) {
    const kept = strongest.get(book.isbn);
    if (!kept || book.rank < kept.rank) strongest.set(book.isbn, book);
  }
  const unique = [...strongest.values()];
  report.books = unique.length;
  report.fromPage = unique.filter((book) => book.rank === PAGE_RANK).length;
  if (unique.length > 0) report.imageUrlPrefix = commonPrefix(unique.map((book) => book.imageUrl));

  const settle = (row: BookRow, imageUrl: string, width: number | null): "unchanged" | "rejectedImage" | null => {
    const current = row.cover_image_id ? deps.repo.getImage(row.cover_image_id) : undefined;
    if (current && (current.source === "upload" || current.source === "publisher" || current.source_url === imageUrl)) return "unchanged";
    if (deps.repo.listRejectedUrls(row.id).has(imageUrl)) return "rejectedImage";
    return width !== null && width < MIN_GOOD_WIDTH && row.cover_image_id ? "unchanged" : null;
  };

  for (const book of unique) {
    let row = deps.repo.findBookByKey(`isbn:${book.isbn}`);
    const memo: { looked?: { edition: OpenLibraryEdition | null } } = {};
    const lookup = async () => {
      if (memo.looked) return memo.looked;
      try {
        memo.looked = { edition: await deps.lookupOpenLibrary(book.isbn) };
      } catch (error) {
        if (!(error instanceof SourceUnavailableError)) throw error;
        report.failed++;
      }
      return memo.looked;
    };
    if (book.rank === PAGE_RANK) {
      let known = row?.title ?? "";
      if (!known) {
        const result = await lookup();
        if (!result) continue;
        known = result.edition?.title ?? "";
      }
      if (!sameTitle(known, book.title)) {
        report.pageTitleMismatch++;
        continue;
      }
    }
    if (!row) {
      let { title, author } = book;
      if (!author) {
        const result = await lookup();
        if (!result) continue;
        if (result.edition?.author) {
          title = result.edition.title ?? title;
          author = result.edition.author;
        } else {
          report.noAuthor++;
          title = "";
          author = "";
        }
      }
      report.created++;
      if (options.dryRun) {
        report.coversSet++;
        continue;
      }
      row = seedBook({ isbn: book.isbn, title, author }, deps.repo, deps.now).book!;
    }
    if (!options.dryRun) deps.repo.setWorkKey(row.id, memo.looked?.edition?.workKey);

    const before = settle(row, book.imageUrl, null);
    if (before) {
      report[before]++;
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
    const fresh = deps.repo.getBook(row.id)!;
    const after = settle(fresh, book.imageUrl, image.width);
    if (after) {
      report[after]++;
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
