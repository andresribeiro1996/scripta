import type { DatabaseSync } from "node:sqlite";
import { canonicalIsbn } from "@scripta/shared";
import { SourcePausedError, SourceUnavailableError } from "../domain/errors.js";
import { hasCopyrightSign, isLossy, retitle, retitleRepairs, textOf, type BookText, type RetitleCandidates } from "../domain/lossy.js";
import type { BookCatalog } from "../domain/ports.js";
import type { LossyBook } from "../domain/types.js";
import { createThrottle, readSiteFeed, SiteSkipped, type ImportDeps } from "./importPublisherCovers.js";
import type { BookRepair, MojibakeApplied, RowRepair } from "./mojibakeRepair.js";
import type { PublisherSite } from "./publishers.js";

type LossyTarget = LossyBook & { publisher_url: string | null };
type IsbndbStatus = "answered" | "no record" | "unavailable" | "not asked";

export interface RetitleDeps {
  fetchText: ImportDeps["fetchText"];
  sleep: (ms: number) => Promise<void>;
  isbndb: Pick<BookCatalog, "search">;
  log: (line: string) => void;
}

export interface LossyPlan {
  targets: number;
  feeds: Record<string, { products: number; matched: number } | { skipped: string }>;
  isbndb: { max: number; asked: number; unavailable: number; notAsked: number; pausedUntil: string | null };
  books: Array<BookRepair & { isbn: string | null }>;
  works: RowRepair[];
  stillLossy: Array<{ id: string; isbn: string | null; text: string; isbndb: IsbndbStatus; candidates: RetitleCandidates }>;
}

const TARGETS_SQL = `
  SELECT books.id, books.title, books.author, books.isbn, books.publisher_url, books.work_id, works.title AS work_title, works.author AS work_author
  FROM books LEFT JOIN works ON works.id = books.work_id
  WHERE books.title LIKE '%©%' OR books.author LIKE '%©%'
  ORDER BY books.rowid
`;

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).hostname.replace(/^www\./, "") : null);

async function readFeeds(targets: LossyTarget[], deps: RetitleDeps, sites: PublisherSite[], plan: LossyPlan, candidates: Map<string, RetitleCandidates>) {
  const byUrl = new Map<string, LossyTarget[]>();
  for (const book of targets) if (book.publisher_url) byUrl.set(book.publisher_url, [...(byUrl.get(book.publisher_url) ?? []), book]);
  const hosts = new Set([...byUrl.keys()].map(hostOf));
  for (const site of sites.filter((site) => hosts.has(hostOf(site.origin)))) {
    try {
      const feed = await readSiteFeed(site, deps.fetchText, createThrottle(deps.sleep));
      let matched = 0;
      for (const product of feed.books) {
        for (const book of byUrl.get(product.productUrl) ?? []) {
          matched++;
          const found = candidates.get(book.id)!;
          found.titles.push(product.title);
          if (product.author) found.authors.push(...product.author.split(", "));
        }
      }
      plan.feeds[site.name] = { products: feed.products, matched };
    } catch (error) {
      if (!(error instanceof SiteSkipped || error instanceof SourceUnavailableError)) throw error;
      plan.feeds[site.name] = { skipped: error.message };
    }
    deps.log(`${site.name}: ${JSON.stringify(plan.feeds[site.name])}`);
  }
}

export async function planLossyRetitles(db: DatabaseSync, deps: RetitleDeps, sites: PublisherSite[], options: { max: number }): Promise<LossyPlan> {
  const targets = (db.prepare(TARGETS_SQL).all() as unknown as LossyTarget[]).filter((book) => isLossy(book.title) || isLossy(book.author));
  const plan: LossyPlan = { targets: targets.length, feeds: {}, isbndb: { max: options.max, asked: 0, unavailable: 0, notAsked: 0, pausedUntil: null }, books: [], works: [], stillLossy: [] };
  const candidates = new Map<string, RetitleCandidates>(targets.map((book) => [book.id, { titles: [], authors: [] }]));
  await readFeeds(targets, deps, sites, plan, candidates);
  for (const book of targets) {
    const found = candidates.get(book.id)!;
    const fromFeed = retitle(book, found);
    let current: BookText = fromFeed ?? book;
    let fromIsbndb: BookText | null = null;
    let status: IsbndbStatus = "not asked";
    const isbn = canonicalIsbn(book.isbn ?? "");
    if (hasCopyrightSign(current)) {
      if (isbn && plan.isbndb.pausedUntil === null && plan.isbndb.asked < options.max) {
        plan.isbndb.asked++;
        try {
          const hit = (await deps.isbndb.search({ isbn }))[0]?.result;
          status = hit ? "answered" : "no record";
          if (hit) {
            found.titles.push(hit.title);
            found.authors.push(...hit.authors);
            fromIsbndb = retitle(current, { titles: [hit.title], authors: hit.authors });
            current = fromIsbndb ?? current;
          }
        } catch (error) {
          if (error instanceof SourcePausedError) plan.isbndb.pausedUntil = new Date(error.retryAt).toISOString();
          else if (error instanceof SourceUnavailableError) {
            status = "unavailable";
            plan.isbndb.unavailable++;
          } else throw error;
        }
      }
      if (status === "not asked") plan.isbndb.notAsked++;
    }
    if (fromFeed || fromIsbndb) {
      const repairs = retitleRepairs(book, current, [fromFeed && "publisher", fromIsbndb && "isbndb"].filter(Boolean).join("+"));
      plan.books.push({ ...repairs.book, isbn: book.isbn });
      if (repairs.work && !plan.works.some((work) => work.id === repairs.work!.id)) plan.works.push(repairs.work);
    }
    if (hasCopyrightSign(current)) plan.stillLossy.push({ id: book.id, isbn: book.isbn, text: textOf(current), isbndb: status, candidates: found });
  }
  deps.log(`isbndb: ${JSON.stringify(plan.isbndb)}`);
  return plan;
}

export function lossyRetitleReport(plan: LossyPlan, applied: MojibakeApplied | null) {
  return {
    dryRun: applied === null,
    targets: plan.targets,
    feeds: plan.feeds,
    isbndb: plan.isbndb,
    retitles: plan.books.map((book) => ({ id: book.id, isbn: book.isbn, from: textOf(book), to: textOf({ title: book.repairedTitle, author: book.repairedAuthor }), source: book.origin })),
    stillLossy: plan.stillLossy,
    applied
  };
}
