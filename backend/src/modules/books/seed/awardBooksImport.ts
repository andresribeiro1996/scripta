import { PRIZES, canonicalIsbn, type PrizeKey } from "@scripta/shared";
import { realSleep, type Sleep } from "../adapters/typesafe/jevRequest.js";
import { listOf, type Binding } from "../adapters/wikidata/sparql.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { lookupIdentity, normalizeWorkKey, workTitleKey } from "../domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit } from "../domain/ports.js";
import { saveCatalogHits } from "../saveHits.js";
import { itemOf, prizeOf } from "./awardsFill.js";

const SAVE_CHUNK = 25;
const SAVE_PAUSE_MS = 250;
const PROGRESS_EVERY = 100;
const UNRESOLVED_LISTED = 50;
const BOOK_PRIZES = (Object.keys(PRIZES) as PrizeKey[]).filter((key) => PRIZES[key].honours === "work");

export type AwardWork = { item: string; prizes: PrizeKey[]; isbns: string[]; olWorkIds: string[] };

export type AwardBooksReport = {
  at: string;
  prizes: Partial<Record<PrizeKey, { candidates: number; resolved: number; created: number; unresolved: number }>>;
  requests: number;
  failedKeys: string[];
  unresolved: string[];
  createdBookIds: string[];
  aliases: number;
  isbnResolutions: Array<{ item: string; isbn: string; title: string }>;
};

export type AwardResolution = { hit: CatalogSearchHit; olWorkId: string | null; isbn: string | null };

export function awardWorksOf(pages: Array<{ kind: string; bindings: Binding[] }>): AwardWork[] {
  const found = new Map<string, { prizes: Set<PrizeKey>; ownIsbns: string[]; editionIsbns: string[]; olWorkIds: string[] }>();
  for (const { kind, bindings } of pages) {
    for (const binding of bindings) {
      const prize = prizeOf(binding);
      if (!binding.work || !prize || PRIZES[prize].honours !== "work" || !Number.isInteger(Number.parseInt(binding.year?.value ?? "", 10))) continue;
      const item = itemOf(binding.work.value);
      const work = found.get(item) ?? { prizes: new Set<PrizeKey>(), ownIsbns: [], editionIsbns: [], olWorkIds: [] };
      found.set(item, work);
      work.prizes.add(prize);
      (kind.endsWith("/edition-isbn") ? work.editionIsbns : work.ownIsbns).push(...listOf(binding, "isbns").map(canonicalIsbn));
      work.olWorkIds.push(...listOf(binding, "olIds"));
    }
  }
  return [...found].map(([item, { prizes, ownIsbns, editionIsbns, olWorkIds }]) => ({
    item,
    prizes: BOOK_PRIZES.filter((key) => prizes.has(key)),
    isbns: [...new Set([...ownIsbns, ...editionIsbns].filter(Boolean))],
    olWorkIds: [...new Set(olWorkIds)]
  }));
}

export function missingAwardWorks(repo: Pick<BooksRepository, "findBookByKey" | "workIdsByWorkKeys">, works: AwardWork[]): AwardWork[] {
  const known = repo.workIdsByWorkKeys([...new Set(works.flatMap((work) => work.olWorkIds))]);
  return works.filter((work) => !work.olWorkIds.some((id) => known.has(id)) && !work.isbns.some((isbn) => repo.findBookByKey(`isbn:${isbn}`)));
}

function usable({ result }: CatalogSearchHit): boolean {
  const identity = lookupIdentity({ title: result.title, author: result.authors.join(", ") });
  return identity !== null && workTitleKey(identity.title, identity.author) !== "";
}

export async function resolveAwardWork(search: BookCatalog["search"], work: AwardWork): Promise<AwardResolution | null> {
  for (const id of work.olWorkIds) {
    const found = (await search({ text: `key:/works/${id}` })).find((hit) => normalizeWorkKey(hit.workKey) === id && usable(hit));
    if (found) return { hit: { ...found, result: { ...found.result, isbn: null, publisher: null } }, olWorkId: id, isbn: null };
  }
  for (const isbn of work.isbns) {
    const found = (await search({ isbn })).find(usable);
    if (found) return { hit: { ...found, result: { ...found.result, isbn, publisher: null } }, olWorkId: null, isbn };
  }
  return null;
}

function aliasWorkKey(repo: Pick<BooksRepository, "getBook" | "workIdsByWorkKeys" | "addWorkAlias">, bookId: string, olWorkId: string, at: string): boolean {
  if (repo.workIdsByWorkKeys([olWorkId]).has(olWorkId)) return false;
  const workId = repo.getBook(bookId)?.work_id;
  if (!workId) return false;
  repo.addWorkAlias(olWorkId, workId, at);
  return true;
}

export async function importAwardBooks(
  deps: { repo: BooksRepository; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean; search: BookCatalog["search"]; log: (line: string) => void; sleep?: Sleep },
  works: AwardWork[],
  at: string,
  { dryRun, max }: { dryRun: boolean; max: number | null }
): Promise<AwardBooksReport> {
  const { repo, sharesArena, search, log, sleep = realSleep } = deps;
  const report: AwardBooksReport = {
    at,
    prizes: Object.fromEntries(BOOK_PRIZES.map((key) => [key, { candidates: 0, resolved: 0, created: 0, unresolved: 0 }])),
    requests: 0,
    failedKeys: [],
    unresolved: [],
    createdBookIds: [],
    aliases: 0,
    isbnResolutions: []
  };
  const countedSearch: BookCatalog["search"] = (query) => {
    report.requests++;
    return search(query);
  };
  const resolved: Array<{ work: AwardWork; hit: CatalogSearchHit; olWorkId: string | null }> = [];
  let unresolved = 0;
  for (const [index, work] of works.entries()) {
    let resolution: AwardResolution | null | undefined;
    try {
      resolution = await resolveAwardWork(countedSearch, work);
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failedKeys.push(work.item);
    }
    for (const prize of work.prizes) {
      const tally = report.prizes[prize]!;
      tally.candidates++;
      if (resolution) tally.resolved++;
      if (resolution === null) tally.unresolved++;
    }
    if (resolution) {
      resolved.push({ work, hit: resolution.hit, olWorkId: resolution.olWorkId });
      if (resolution.isbn) report.isbnResolutions.push({ item: work.item, isbn: resolution.isbn, title: resolution.hit.result.title });
    }
    if (resolution === null) {
      unresolved++;
      if (report.unresolved.length < UNRESOLVED_LISTED) report.unresolved.push(work.item);
    }
    if ((index + 1) % PROGRESS_EVERY === 0) log(JSON.stringify({ resolved: resolved.length, unresolved, failed: report.failedKeys.length }));
  }
  if (dryRun) return report;

  const toSave = max === null ? resolved : resolved.slice(0, max);
  const created = new Set<string>();
  const createdByPrize = new Map<PrizeKey, Set<string>>();
  for (let start = 0; start < toSave.length; start += SAVE_CHUNK) {
    if (start > 0) await sleep(SAVE_PAUSE_MS);
    const chunk = toSave.slice(start, start + SAVE_CHUNK);
    const saved = saveCatalogHits({ repo, sharesArena }, chunk.map(({ hit }) => hit), at);
    for (const [index, row] of saved.entries()) {
      if (!row) continue;
      const { work, olWorkId } = chunk[index]!;
      if (olWorkId && aliasWorkKey(repo, row.id, olWorkId, at)) report.aliases++;
      if (row.created_at !== at) continue;
      created.add(row.id);
      for (const prize of work.prizes) createdByPrize.set(prize, (createdByPrize.get(prize) ?? new Set<string>()).add(row.id));
    }
  }
  for (const [prize, ids] of createdByPrize) report.prizes[prize]!.created = ids.size;
  report.createdBookIds = [...created];
  return report;
}
