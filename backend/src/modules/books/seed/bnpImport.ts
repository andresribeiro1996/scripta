import { ObjectStoreUnavailableError } from "../../../storage/objectStore.js";
import { storeCoverImage } from "../booksService.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { fillMissingIdentity, keysOf } from "../domain/findOrCreate.js";
import { encodeCover, isAcceptableCover, type EncodedCover } from "../domain/images.js";
import { editionLanguage, isPortugueseIsbn, lookupIdentity } from "../domain/normalize.js";
import type { BooksRepository, CoverBlobStore } from "../domain/ports.js";
import type { BookRow, CoverImageRow } from "../domain/types.js";
import { mapBnpRecord, readMarcRecords, readOaiError, readResumptionToken, type BnpBook } from "./bnpRecord.js";
import { BNP_SKIPS, bnpSkipReason, udcGenres, type BnpSkip } from "./bnpScope.js";
import { utcDay } from "../typesafe.js";
import { fetchBytes, fetchText } from "./siteFetch.js";

export interface BnpDeps {
  repo: BooksRepository;
  blobs: CoverBlobStore;
  fetchScan: (url: string) => Promise<EncodedCover | null>;
  now: () => Date;
}

export type BnpReplace = "new" | "none" | "lowRes" | "isbndb";
export type BnpCoverAction = "stored" | "kept" | "noScan" | "rejected" | "failed";

export interface BnpPlan {
  book: BnpBook;
  isbn: string;
  existing: BookRow | undefined;
  replace: BnpReplace | null;
}

export function bnpReplaceReason(existing: BookRow | undefined, image: CoverImageRow | undefined): BnpReplace | null {
  if (!existing) return "new";
  if (existing.cover_status === "manual") return null;
  if (!existing.cover_image_id) return "none";
  if (image?.source === "bnp") return null;
  if (existing.cover_status === "low_res") return "lowRes";
  if (image?.source === "isbndb" && isPortugueseIsbn(existing.isbn)) return "isbndb";
  return null;
}

type ReplaceRepo = Pick<BooksRepository, "getImage" | "listRejectedUrls">;

function replaceReasonOf(repo: ReplaceRepo, row: BookRow | undefined, scanUrl: string | null): BnpReplace | null {
  if (row && scanUrl !== null && repo.listRejectedUrls(row.id).has(scanUrl)) return null;
  return bnpReplaceReason(row, row?.cover_image_id ? repo.getImage(row.cover_image_id) : undefined);
}

export function planBnpRecord(repo: ReplaceRepo & Pick<BooksRepository, "findBookByKey">, book: BnpBook, isbn: string | undefined = book.isbns[0]): BnpPlan | null {
  if (isbn === undefined) return null;
  const existing = repo.findBookByKey(`isbn:${isbn}`);
  return { book, isbn, existing, replace: replaceReasonOf(repo, existing, book.scanUrl) };
}

export async function applyBnpRecord(deps: BnpDeps, plan: BnpPlan): Promise<{ book: BookRow; created: boolean; cover: BnpCoverAction }> {
  const { book, isbn } = plan;
  const identity = lookupIdentity({ isbn, title: book.title, author: book.author });
  if (!identity?.isbn) throw new Error(`Not a valid ISBN: ${isbn}`);
  const at = deps.now().toISOString();

  let scan: { url: string; image: EncodedCover } | null = null;
  let cover: BnpCoverAction = book.scanUrl === null ? "noScan" : "kept";
  if (plan.replace !== null && book.scanUrl !== null) {
    let image: EncodedCover | null = null;
    try {
      image = await deps.fetchScan(book.scanUrl);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError)) throw error;
    }
    if (image === null) cover = "failed";
    else if (!isAcceptableCover("bnp", image.width, image.height)) cover = "rejected";
    else scan = { url: book.scanUrl, image };
  }

  const written = deps.repo.transaction(() => {
    const held = deps.repo.findBookByKey(`isbn:${isbn}`);
    const row = held ?? deps.repo.createBook({ title: identity.title, author: identity.author, isbn: identity.isbn, year: book.year, publisher: book.publisher, genres: udcGenres(book.udc), createdBy: "bnp" }, keysOf(deps.repo, identity), at);
    if (held) {
      fillMissingIdentity(deps.repo, held, identity.title, identity.author);
      deps.repo.fillSubjectGenres(held.id, udcGenres(book.udc));
      deps.repo.confirmWithSource(held.id, "bnp");
    } else {
      deps.repo.setCover(row.id, { imageId: null, status: null, checkedAt: at });
    }
    deps.repo.mergeDetails(row.id, { summary: book.summary, pages: book.pages, year: book.year, publisher: book.publisher, translator: book.translator }, "bnp");
    if (book.originalTitle) deps.repo.fillOriginalTitle(row.id, book.originalTitle);
    deps.repo.setLanguage(row.id, editionLanguage(book.languages, isbn));
    return { id: row.id, created: held === undefined, replaceable: replaceReasonOf(deps.repo, row, book.scanUrl) !== null, expected: row.cover_image_id };
  });

  if (scan !== null) {
    if (written.replaceable) {
      let imageId: string | null = null;
      try {
        imageId = await storeCoverImage(deps, written.id, "bnp", scan.url, scan.image, at);
      } catch (error) {
        if (!(error instanceof ObjectStoreUnavailableError)) throw error;
      }
      if (imageId === null) cover = "failed";
      else cover = deps.repo.setCoverIf(written.id, written.expected, { imageId, status: scan.image.width >= MIN_GOOD_WIDTH ? "good" : "low_res", checkedAt: at }) ? "stored" : "kept";
    } else {
      cover = "kept";
    }
  }
  return { book: deps.repo.getBook(written.id)!, created: written.created, cover };
}

export async function fetchBnpScan(url: string, timeoutMs?: number): Promise<EncodedCover | null> {
  const bytes = await fetchBytes(url, timeoutMs);
  return bytes === null ? null : encodeCover(bytes);
}

export const fetchBnpPage = (url: string) => fetchText(url, BNP_PAGE_TIMEOUT_MS);

export interface BnpHarvestDeps extends BnpDeps {
  fetchText: (url: string) => Promise<{ status: number; text: string }>;
  log: (line: string) => void;
}

export interface BnpImportOptions {
  from: string;
  until: string;
  dryRun: boolean;
  cursorOnSuccess: boolean;
}

export interface BnpImportReport {
  dryRun: boolean;
  from: string;
  until: string;
  through: string | null;
  records: number;
  deleted: number;
  kept: number;
  created: number;
  matched: number;
  skipped: Record<BnpSkip, number>;
  covers: Record<BnpCoverAction, number>;
  replace: Record<BnpReplace, number>;
  genres: Record<string, number>;
  publishers: { kept: Array<[string, number]>; dropped: Record<BnpSkip, Array<[string, number]>> };
  samples: BnpBook[];
  failedWindows: string[];
}

export const BNP_OAI = "https://oai.bnportugal.gov.pt/servlet/OAIHandler";
export const BNP_ISBN_URL = "https://urn.porbase.org/isbn/unimarc/marcxchange?id=";
export const BNP_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const BNP_PAGE_TIMEOUT_MS = 120_000;

const SCAN_POOL = 2;
const TOP_PUBLISHERS = 50;
const SAMPLES = 20;
const OAI_END = /<\/OAI-PMH>\s*$/;
const LOOKUP_MISS = /<urn-response>\s*<error>Registo inexistente<\/error>\s*<\/urn-response>|<collection\b[^>]*(?:\/>|>\s*<\/collection>)/;

type DateWindow = { from: string; until: string };
type Harvested = { records: number; deleted: number; kept: BnpBook[]; skipped: Array<[BnpSkip, string | null]> };
type Page = { xml: string } | { failure: string; transient: boolean };
type Outcome = { created: boolean; replace: BnpReplace | null; cover: BnpCoverAction };

export function utcDate(at: Date): string {
  return utcDay(at.getTime());
}

export function monthWindows(from: string, until: string): DateWindow[] {
  const windows: DateWindow[] = [];
  for (let start = from; start <= until; ) {
    const [year, month] = start.split("-").map(Number) as [number, number];
    const monthEnd = utcDate(new Date(Date.UTC(year, month, 0)));
    windows.push({ from: start, until: monthEnd < until ? monthEnd : until });
    start = utcDate(new Date(Date.UTC(year, month, 1)));
  }
  return windows;
}

const firstUrl = (window: DateWindow) => `${BNP_OAI}?verb=ListRecords&metadataPrefix=marcxchange&set=bibliografianacional&from=${window.from}&until=${window.until}`;
const nextUrl = (token: string) => `${BNP_OAI}?verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`;

async function tryPage(fetchText: BnpHarvestDeps["fetchText"], url: string): Promise<Page> {
  try {
    const { status, text } = await fetchText(url);
    if (status !== 200) return { failure: `HTTP ${status}`, transient: true };
    const code = readOaiError(text);
    if (code !== null) return { failure: code, transient: false };
    return OAI_END.test(text) ? { xml: text } : { failure: "truncated", transient: true };
  } catch (error) {
    if (error instanceof SourceUnavailableError) return { failure: error.message, transient: true };
    throw error;
  }
}

async function fetchPage(fetchText: BnpHarvestDeps["fetchText"], url: string, retry: boolean): Promise<Page> {
  const page = await tryPage(fetchText, url);
  return retry && "failure" in page && page.transient ? tryPage(fetchText, url) : page;
}

async function harvestOnce(fetchText: BnpHarvestDeps["fetchText"], window: DateWindow): Promise<Harvested | string> {
  const harvested: Harvested = { records: 0, deleted: 0, kept: [], skipped: [] };
  let url: string | null = firstUrl(window);
  let number = 0;
  while (url !== null) {
    number++;
    const page = await fetchPage(fetchText, url, number === 1);
    if ("failure" in page) return `page ${number}: ${page.failure}`;
    for (const record of readMarcRecords(page.xml)) {
      harvested.records++;
      if (record.deleted) {
        harvested.deleted++;
        continue;
      }
      const book = mapBnpRecord(record);
      const reason = bnpSkipReason(book);
      if (reason === null) harvested.kept.push(book);
      else harvested.skipped.push([reason, book.publisher]);
    }
    const token = readResumptionToken(page.xml);
    url = token === null ? null : nextUrl(token);
  }
  return harvested;
}

async function harvestWindow(fetchText: BnpHarvestDeps["fetchText"], window: DateWindow): Promise<Harvested | string> {
  const first = await harvestOnce(fetchText, window);
  if (typeof first !== "string") return first;
  const second = await harvestOnce(fetchText, window);
  return typeof second === "string" ? `${first}; ${second}` : second;
}

async function applyPooled(books: BnpBook[], apply: (book: BnpBook) => Promise<void>): Promise<void> {
  const waiting = [...books];
  const running = new Map<string, Promise<unknown>>();
  const failures: unknown[] = [];
  while (failures.length === 0 && (waiting.length > 0 || running.size > 0)) {
    while (running.size < SCAN_POOL) {
      const next = waiting.findIndex((book) => !running.has(book.isbns[0]!));
      if (next < 0) break;
      const book = waiting.splice(next, 1)[0]!;
      const isbn = book.isbns[0]!;
      running.set(isbn, apply(book).catch((error) => failures.push(error)).finally(() => running.delete(isbn)));
    }
    await Promise.race(running.values());
  }
  await Promise.all(running.values());
  if (failures.length > 0) throw failures[0];
}

function planOutcome(plan: BnpPlan | null, seenBefore: boolean, book: BnpBook): Outcome {
  const replace = plan?.replace ?? null;
  const cover = book.scanUrl === null ? "noScan" : replace !== null ? "stored" : "kept";
  return { created: !seenBefore && plan?.existing === undefined, replace, cover };
}

function perSkip<T>(make: (reason: BnpSkip) => T): Record<BnpSkip, T> {
  return Object.fromEntries(BNP_SKIPS.map((reason) => [reason, make(reason)])) as Record<BnpSkip, T>;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const top = (counts: Map<string, number>): Array<[string, number]> => [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_PUBLISHERS);

export async function importBnp(deps: BnpHarvestDeps, options: BnpImportOptions): Promise<BnpImportReport> {
  const report: BnpImportReport = {
    dryRun: options.dryRun,
    from: options.from,
    until: options.until,
    through: null,
    records: 0,
    deleted: 0,
    kept: 0,
    created: 0,
    matched: 0,
    skipped: perSkip(() => 0),
    covers: { stored: 0, kept: 0, noScan: 0, rejected: 0, failed: 0 },
    replace: { new: 0, none: 0, lowRes: 0, isbndb: 0 },
    genres: {},
    publishers: { kept: [], dropped: perSkip(() => []) },
    samples: [],
    failedWindows: []
  };
  const keptPublishers = new Map<string, number>();
  const droppedPublishers = perSkip(() => new Map<string, number>());
  const seen = new Set<string>();
  const tally = ({ created, replace, cover }: Outcome) => {
    report[created ? "created" : "matched"]++;
    report.covers[cover]++;
    if (replace !== null) report.replace[replace]++;
  };
  const applyOne = async (book: BnpBook) => {
    await new Promise(setImmediate);
    const plan = planBnpRecord(deps.repo, book)!;
    const result = await applyBnpRecord(deps, plan);
    tally({ created: result.created, replace: plan.replace, cover: result.cover });
  };

  let broken = false;
  for (const window of monthWindows(options.from, options.until)) {
    const label = `${window.from}..${window.until}`;
    const coversFailedBefore = report.covers.failed;
    const result = await harvestWindow(deps.fetchText, window);
    const harvested = typeof result === "string" ? null : result;
    const failure = typeof result === "string" ? result : null;
    if (harvested === null) {
      broken = true;
      report.failedWindows.push(label);
    } else {
      report.records += harvested.records;
      report.deleted += harvested.deleted;
      report.kept += harvested.kept.length;
      for (const [reason, publisher] of harvested.skipped) {
        report.skipped[reason]++;
        if (publisher !== null) bump(droppedPublishers[reason], publisher);
      }
      for (const book of harvested.kept) {
        if (book.publisher !== null) bump(keptPublishers, book.publisher);
        for (const genre of udcGenres(book.udc)) report.genres[genre] = (report.genres[genre] ?? 0) + 1;
        if (report.samples.length < SAMPLES) report.samples.push(book);
      }
      if (options.dryRun) {
        for (const book of harvested.kept) {
          const isbn = book.isbns[0]!;
          const seenBefore = seen.has(isbn);
          seen.add(isbn);
          tally(planOutcome(seenBefore ? null : planBnpRecord(deps.repo, book)!, seenBefore, book));
        }
      } else {
        await applyPooled(harvested.kept, applyOne);
      }
    }
    if (!broken) report.through = window.until;
    deps.log(JSON.stringify({ window: label, through: report.through, records: harvested?.records ?? 0, kept: harvested?.kept.length ?? 0, failed: failure, coversFailed: report.covers.failed - coversFailedBefore }));
  }

  report.publishers = { kept: top(keptPublishers), dropped: perSkip((reason) => top(droppedPublishers[reason])) };
  if (options.cursorOnSuccess && !options.dryRun && report.failedWindows.length === 0) deps.repo.setHarvestCursor("bnp", options.until);
  return report;
}

export interface BnpSyncLog {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
}

export function logBnpSync(log: BnpSyncLog, report: BnpImportReport): void {
  const { through, kept, created, covers, failedWindows } = report;
  const details = { through, kept, created, coversFailed: covers.failed, failedWindows };
  if (failedWindows.length > 0) log.error(details, "bnp sync failed windows");
  else log.info(details, "bnp sync");
}

export async function lookupBnpIsbn(deps: BnpHarvestDeps, isbn: string): Promise<BookRow | null> {
  const { status, text } = await deps.fetchText(BNP_ISBN_URL + isbn);
  if (status !== 200) throw new SourceUnavailableError("urn.porbase.org", `HTTP ${status}`, { status });
  const record = readMarcRecords(text)[0];
  if (record !== undefined) return (await applyBnpRecord(deps, planBnpRecord(deps.repo, mapBnpRecord(record), isbn)!)).book;
  if (LOOKUP_MISS.test(text)) return null;
  throw new SourceUnavailableError("urn.porbase.org", "unexpected reply");
}

export async function syncBnp(deps: BnpHarvestDeps): Promise<BnpImportReport | null> {
  const cursor = deps.repo.getHarvestCursor("bnp");
  if (cursor === null) return null;
  return importBnp(deps, { from: cursor, until: utcDate(deps.now()), dryRun: false, cursorOnSuccess: true });
}
