import { canonicalIsbn } from "@scripta/shared";
import { SourceUnavailableError } from "../domain/errors.js";
import type { BooksRepository, EditionRecordSource } from "../domain/ports.js";
import type { SeriesEntry } from "../domain/series.js";
import { seriesLikeGroups } from "../domain/translation.js";
import { harvestWindow, type BnpHarvestDeps, type DateWindow } from "./bnpImport.js";

export interface FillOptions {
  dryRun: boolean;
}

export interface WikidataRow {
  isbns: string[];
  olWorkIds: string[];
  series: string;
  position: string | null;
}

export interface OriginalTitleCandidate {
  name: string;
  workIds: string[];
  titles: string[];
}

const BATCH_SIZE = 300;
const BATCH_PAUSE_MS = 100;
const OPEN_LIBRARY_WORK = /^OL\d+W$/;

async function inBatches<T>(repo: Pick<BooksRepository, "transaction">, items: T[], write: (item: T) => boolean | number): Promise<number> {
  let added = 0;
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    if (start > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    added += repo.transaction(() => items.slice(start, start + BATCH_SIZE).reduce((total, item) => total + Number(write(item)), 0));
  }
  return added;
}

type Binding = Record<string, { value: string } | undefined>;

const listOf = (binding: Binding, name: string) => (binding[name]?.value ?? "").split("|").map((item) => item.trim()).filter(Boolean);

export function wikidataRowOf(binding: Binding): WikidataRow | null {
  const series = [binding.en, binding.any].map((label) => label?.value.trim() ?? "").find(Boolean);
  if (series === undefined) return null;
  return {
    isbns: listOf(binding, "isbns"),
    olWorkIds: listOf(binding, "olIds").filter((id) => OPEN_LIBRARY_WORK.test(id)),
    series,
    position: binding.position?.value.trim() || null
  };
}

export async function fillFromWikidata(
  repo: Pick<BooksRepository, "transaction" | "findBookByKey" | "workIdsByWorkKeys" | "addWorkSeries">,
  rows: WikidataRow[],
  at: string,
  { dryRun }: FillOptions
): Promise<{ matched: number; added: number }> {
  const byOpenLibraryKey = repo.workIdsByWorkKeys([...new Set(rows.flatMap((row) => row.olWorkIds))]);
  const writes: Array<{ workId: string; entry: SeriesEntry }> = [];
  for (const row of rows) {
    const workIds = new Set<string>();
    for (const isbn of row.isbns) {
      const canonical = canonicalIsbn(isbn);
      const workId = canonical ? repo.findBookByKey(`isbn:${canonical}`)?.work_id : null;
      if (workId) workIds.add(workId);
    }
    for (const key of row.olWorkIds) {
      const workId = byOpenLibraryKey.get(key);
      if (workId) workIds.add(workId);
    }
    for (const workId of workIds) writes.push({ workId, entry: { name: row.series, position: row.position } });
  }
  const added = dryRun ? 0 : await inBatches(repo, writes, ({ workId, entry }) => repo.addWorkSeries(workId, [entry], "wikidata", at));
  return { matched: writes.length, added };
}

export function listOriginalTitleSeries(repo: Pick<BooksRepository, "originalTitleClaims">): OriginalTitleCandidate[] {
  return seriesLikeGroups(repo.originalTitleClaims())
    .map(({ originalTitle, workIds, titles }) => ({ name: originalTitle, workIds, titles }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function fillFromOriginalTitles(
  repo: Pick<BooksRepository, "transaction" | "originalTitleClaims" | "addWorkSeries">,
  approvedNames: string[],
  at: string,
  { dryRun }: FillOptions
): Promise<{ names: number; works: number; added: number }> {
  const candidates = listOriginalTitleSeries(repo);
  const known = new Set(candidates.map((candidate) => candidate.name));
  const unknown = approvedNames.filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`Not an original-title candidate: ${unknown.join("; ")}`);
  const approved = new Set(approvedNames);
  const writes = candidates.filter((candidate) => approved.has(candidate.name)).flatMap((candidate) => candidate.workIds.map((workId) => ({ workId, entry: { name: candidate.name, position: null } })));
  const added = dryRun ? 0 : await inBatches(repo, writes, ({ workId, entry }) => repo.addWorkSeries(workId, [entry], "original-title", at));
  return { names: approved.size, works: writes.length, added };
}

export async function fillBnpCollections(
  deps: Pick<BnpHarvestDeps, "repo" | "fetchText" | "now" | "log">,
  windows: DateWindow[],
  { dryRun }: FillOptions
): Promise<{ windows: number; records: number; matched: number; added: number; failedWindows: string[] }> {
  const report = { windows: 0, records: 0, matched: 0, added: 0, failedWindows: [] as string[] };
  for (const window of windows) {
    const label = `${window.from}..${window.until}`;
    report.windows++;
    const harvested = await harvestWindow(deps.fetchText, window);
    if (typeof harvested === "string") {
      report.failedWindows.push(label);
      deps.log(JSON.stringify({ window: label, failed: harvested }));
      continue;
    }
    const writes = harvested.kept.flatMap((book) => {
      const held = book.collection ? deps.repo.findBookByKey(`isbn:${book.isbns[0]}`) : undefined;
      return held && book.collection ? [{ bookId: held.id, entry: book.collection }] : [];
    });
    const at = deps.now().toISOString();
    const added = dryRun ? 0 : await inBatches(deps.repo, writes, ({ bookId, entry }) => deps.repo.addBookCollection(bookId, entry, "bnp", at));
    report.records += harvested.records;
    report.matched += writes.length;
    report.added += added;
    deps.log(JSON.stringify({ window: label, records: harvested.records, matched: writes.length, added }));
  }
  return report;
}

export async function fillHeldEditions(
  repo: Pick<BooksRepository, "canonicalWorkIds" | "editionsOf" | "addBookCollection">,
  catalog: EditionRecordSource,
  heldWorkIds: string[],
  at: string,
  { dryRun }: FillOptions
): Promise<{ asked: number; added: number; failed: number }> {
  const live = [...new Set(repo.canonicalWorkIds(heldWorkIds).values())];
  const editions = repo.editionsOf(live).flatMap((edition) => (edition.isbn === null ? [] : [{ id: edition.id, isbn: edition.isbn }]));
  const report = { asked: editions.length, added: 0, failed: 0 };
  if (dryRun) return report;
  for (const edition of editions) {
    try {
      const record = await catalog.fetchEditionRecord(edition.isbn);
      for (const entry of record?.series ?? []) {
        if (repo.addBookCollection(edition.id, entry, "ol-edition", at)) report.added++;
      }
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failed++;
    }
  }
  return report;
}
