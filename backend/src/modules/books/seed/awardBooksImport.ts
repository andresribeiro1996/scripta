import { PRIZES, canonicalIsbn, type PrizeKey } from "@scripta/shared";
import { realSleep, type Sleep } from "../adapters/typesafe/jevRequest.js";
import { listOf, type Binding } from "../adapters/wikidata/sparql.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { authorMatches, lookupIdentity, normalizeWorkKey, titleMatches, workTitleKey } from "../domain/normalize.js";
import type { BookCatalog, BooksRepository, CatalogSearchHit } from "../domain/ports.js";
import { saveCatalogHits } from "../saveHits.js";
import { itemOf, prizeOf } from "./awardsFill.js";

const SAVE_CHUNK = 25;
const SAVE_PAUSE_MS = 250;
const PROGRESS_EVERY = 100;
const NAMES_CHUNK = 200;
const NAMES_GAP_MS = 5_000;
const UNRESOLVED_LISTED = 50;
const BOOK_PRIZES = (Object.keys(PRIZES) as PrizeKey[]).filter((key) => PRIZES[key].honours === "work");

export type AwardWork = { item: string; prizes: PrizeKey[]; isbns: string[]; olWorkIds: string[]; titles: string[]; authors: string[] };

export type AwardBooksReport = {
  at: string;
  prizes: Partial<Record<PrizeKey, { candidates: number; resolved: number; created: number; unresolved: number }>>;
  requests: number;
  failedKeys: string[];
  unresolved: string[];
  createdBookIds: string[];
  aliases: number;
  skipped: number;
  isbnResolutions: Array<{ item: string; isbn: string; title: string }>;
  originalSwaps: Array<{ item: string; from: string; to: string; olWorkId: string; workKey: string }>;
  workIdMismatches: Array<{ item: string; olTitle: string; wikidataTitles: string[] }>;
};

export type AwardResolution = { hit: CatalogSearchHit; olWorkId: string | null; isbn: string | null; translatedFrom?: string };

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
    olWorkIds: [...new Set(olWorkIds)],
    titles: [],
    authors: []
  }));
}

export function missingAwardWorks(repo: Pick<BooksRepository, "findBookByKey" | "workIdsByWorkKeys">, works: AwardWork[]): AwardWork[] {
  const known = repo.workIdsByWorkKeys([...new Set(works.flatMap((work) => work.olWorkIds))]);
  return works.filter((work) => !work.olWorkIds.some((id) => known.has(id)) && !work.isbns.some((isbn) => repo.findBookByKey(`isbn:${isbn}`)));
}

const namesQuery = (items: string[]) => `
SELECT ?work (SAMPLE(?enLabel) AS ?label) (GROUP_CONCAT(DISTINCT ?title; SEPARATOR="|") AS ?titles) (GROUP_CONCAT(DISTINCT ?author; SEPARATOR="|") AS ?authors) WHERE {
  VALUES ?work { ${items.map((id) => `wd:${id}`).join(" ")} }
  OPTIONAL { ?work wdt:P1476 ?title }
  OPTIONAL { ?work rdfs:label ?enLabel . FILTER(LANG(?enLabel) = "en") }
  OPTIONAL {
    ?work wdt:P50 ?person .
    OPTIONAL { ?person rdfs:label ?enName . FILTER(LANG(?enName) = "en") }
    OPTIONAL { ?person rdfs:label ?anyName . FILTER NOT EXISTS { ?person rdfs:label ?en2 . FILTER(LANG(?en2) = "en") } }
    BIND(COALESCE(?enName, ?anyName) AS ?author)
  }
}
GROUP BY ?work`;

export async function withWikidataNames(query: (query: string) => Promise<Binding[]>, works: AwardWork[], sleep: Sleep = realSleep): Promise<AwardWork[]> {
  const names = new Map<string, { titles: string[]; authors: string[] }>();
  for (let start = 0; start < works.length; start += NAMES_CHUNK) {
    await sleep(NAMES_GAP_MS);
    for (const binding of await query(namesQuery(works.slice(start, start + NAMES_CHUNK).map((work) => work.item)))) {
      if (!binding.work) continue;
      const label = binding.label?.value.trim() ?? "";
      names.set(itemOf(binding.work.value), { titles: [...new Set([...listOf(binding, "titles"), ...(label ? [label] : [])])], authors: [...new Set(listOf(binding, "authors"))] });
    }
  }
  return works.map((work) => ({ ...work, ...names.get(work.item) }));
}

function usable({ result }: CatalogSearchHit): boolean {
  const identity = lookupIdentity({ title: result.title, author: result.authors.join(", ") });
  return identity !== null && workTitleKey(identity.title, identity.author) !== "";
}

const titleFits = (work: AwardWork, { result }: CatalogSearchHit) => work.titles.length === 0 || work.titles.some((title) => titleMatches(title, result.title));

export async function resolveAwardWork(search: BookCatalog["search"], work: AwardWork, onMismatch: (olTitle: string) => void = () => {}): Promise<AwardResolution | null> {
  let translated: { olWorkId: string; title: string } | null = null;
  for (const id of work.olWorkIds) {
    const found = (await search({ text: `key:/works/${id}` })).find((hit) => normalizeWorkKey(hit.workKey) === id && usable(hit));
    if (!found) continue;
    if (titleFits(work, found)) return { hit: { ...found, result: { ...found.result, isbn: null, publisher: null } }, olWorkId: id, isbn: null };
    translated ??= { olWorkId: id, title: found.result.title };
  }
  if (translated && work.authors.length > 0) {
    const original = (await search({ text: `${work.titles[0]} ${work.authors[0]}` })).find(
      (hit) => normalizeWorkKey(hit.workKey) !== null && usable(hit) && titleFits(work, hit) && authorMatches(work.authors.join(", "), hit.result.authors)
    );
    if (original) return { hit: { ...original, result: { ...original.result, isbn: null, publisher: null } }, olWorkId: translated.olWorkId, isbn: null, translatedFrom: translated.title };
  }
  if (translated) onMismatch(translated.title);
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
  allWorks: AwardWork[],
  at: string,
  { dryRun, max, skip = new Set<string>() }: { dryRun: boolean; max: number | null; skip?: ReadonlySet<string> }
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
    skipped: 0,
    isbnResolutions: [],
    originalSwaps: [],
    workIdMismatches: []
  };
  const works = allWorks.filter((work) => !skip.has(work.item));
  report.skipped = allWorks.length - works.length;
  const countedSearch: BookCatalog["search"] = (query) => {
    report.requests++;
    return search(query);
  };
  const resolved: Array<{ work: AwardWork; hit: CatalogSearchHit; olWorkId: string | null }> = [];
  let unresolved = 0;
  for (const [index, work] of works.entries()) {
    let resolution: AwardResolution | null | undefined;
    let mismatch: string | null = null;
    try {
      resolution = await resolveAwardWork(countedSearch, work, (olTitle) => (mismatch = olTitle));
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failedKeys.push(work.item);
    }
    if (mismatch !== null && resolution !== undefined) report.workIdMismatches.push({ item: work.item, olTitle: mismatch, wikidataTitles: work.titles });
    for (const prize of work.prizes) {
      const tally = report.prizes[prize]!;
      tally.candidates++;
      if (resolution) tally.resolved++;
      if (resolution === null) tally.unresolved++;
    }
    if (resolution) {
      resolved.push({ work, hit: resolution.hit, olWorkId: resolution.olWorkId });
      if (resolution.translatedFrom) {
        report.originalSwaps.push({ item: work.item, from: resolution.translatedFrom, to: resolution.hit.result.title, olWorkId: resolution.olWorkId!, workKey: normalizeWorkKey(resolution.hit.workKey)! });
      }
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
