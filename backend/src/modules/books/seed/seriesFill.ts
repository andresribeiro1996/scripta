import { listOf, type Binding } from "../adapters/wikidata/sparql.js";
import { SourceUnavailableError } from "../domain/errors.js";
import type { BooksRepository, EditionRecordSource } from "../domain/ports.js";
import { seriesNameKey, type SeriesEntry } from "../domain/series.js";
import { seriesLikeGroups } from "../domain/translation.js";
import { harvestWindow, type BnpHarvestDeps, type DateWindow } from "./bnpImport.js";
import { inBatches, matchWorkIds } from "./wikidataMatch.js";

export interface FillOptions {
  dryRun: boolean;
}

export interface WikidataOptions extends FillOptions {
  skip?: ReadonlySet<string>;
  tally?: WikidataTally;
}

export interface HeldOptions extends FillOptions {
  log: (line: string) => void;
}

export interface WikidataTally {
  series: Map<string, { name: string; workIds: Set<string> }>;
  skipped: Set<string>;
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

const HELD_PROGRESS_EVERY = 25;
const OPEN_LIBRARY_WORK = /^OL\d+W$/;

export function wikidataRowOf(binding: Binding): WikidataRow | null {
  const series = [binding.en, binding.pt, binding.any].map((label) => label?.value.trim() ?? "").find(Boolean);
  if (series === undefined) return null;
  return {
    isbns: listOf(binding, "isbns"),
    olWorkIds: listOf(binding, "olIds").filter((id) => OPEN_LIBRARY_WORK.test(id)),
    series,
    position: binding.position?.value.trim() || null
  };
}

export const wikidataTally = (): WikidataTally => ({ series: new Map(), skipped: new Set() });

export function seriesCounts(tally: WikidataTally): Array<{ name: string; works: number }> {
  return [...tally.series.values()]
    .map(({ name, workIds }) => ({ name, works: workIds.size }))
    .sort((left, right) => right.works - left.works || left.name.localeCompare(right.name));
}

export async function fillFromWikidata(
  repo: Pick<BooksRepository, "transaction" | "findBookByKey" | "workIdsByWorkKeys" | "addWorkSeries">,
  fetchWork: (olWorkKey: string) => Promise<unknown>,
  rows: WikidataRow[],
  at: string,
  { dryRun, skip = new Set(), tally = wikidataTally() }: WikidataOptions
): Promise<{ matched: number; added: number; redirected: number; failedKeys: string[]; failedSeries: string[] }> {
  const kept: Array<{ row: WikidataRow; nameKey: string }> = [];
  const skipped = new Set<string>();
  for (const row of rows) {
    const nameKey = seriesNameKey(row.series);
    if (nameKey === null) continue;
    if (skip.has(nameKey)) skipped.add(nameKey);
    else kept.push({ row, nameKey });
  }
  const { workIds, redirected, failedKeys } = await matchWorkIds(repo, fetchWork, kept.map(({ row }) => row));
  for (const nameKey of skipped) tally.skipped.add(nameKey);
  const failed = new Set(failedKeys);
  const failedSeries = new Map<string, string>();
  for (const { row, nameKey } of kept) {
    if (!failedSeries.has(nameKey) && row.olWorkIds.some((olKey) => failed.has(olKey))) failedSeries.set(nameKey, row.series);
  }
  const writes: Array<{ workId: string; entry: SeriesEntry }> = [];
  for (const [index, { row, nameKey }] of kept.entries()) {
    for (const workId of workIds[index]!) {
      writes.push({ workId, entry: { name: row.series, position: row.position } });
      const counted = tally.series.get(nameKey) ?? { name: row.series, workIds: new Set<string>() };
      counted.workIds.add(workId);
      tally.series.set(nameKey, counted);
    }
  }
  const added = dryRun ? 0 : await inBatches(repo, writes, ({ workId, entry }) => repo.addWorkSeries(workId, [entry], "wikidata", at));
  return { matched: writes.length, added, redirected, failedKeys, failedSeries: [...failedSeries.values()].sort((left, right) => left.localeCompare(right)) };
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
    const harvested = await harvestWindow(deps.fetchText, "bibliografianacional", window);
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
  { dryRun, log }: HeldOptions
): Promise<{ asked: number; added: number; failedIsbns: string[] }> {
  const live = [...new Set(repo.canonicalWorkIds(heldWorkIds).values())];
  const editions = repo.editionsOf(live).flatMap((edition) => (edition.isbn === null ? [] : [{ id: edition.id, isbn: edition.isbn }]));
  const report = { asked: editions.length, added: 0, failedIsbns: [] as string[] };
  if (dryRun) return report;
  for (const [index, edition] of editions.entries()) {
    try {
      const record = await catalog.fetchEditionRecord(edition.isbn);
      for (const entry of record?.series ?? []) {
        if (repo.addBookCollection(edition.id, entry, "ol-edition", at)) report.added++;
      }
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failedIsbns.push(edition.isbn);
    }
    if ((index + 1) % HELD_PROGRESS_EVERY === 0) log(JSON.stringify({ asked: index + 1, of: editions.length, added: report.added, failed: report.failedIsbns.length }));
  }
  return report;
}
