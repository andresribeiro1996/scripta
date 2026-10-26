import type { CleanedSubjects } from "../domain/workSubjects.js";
import type { BooksRepository } from "../domain/ports.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { realSleep, type Sleep } from "../adapters/typesafe/jevRequest.js";

export const CHARACTER_BATCH = 100;
export const CHARACTER_RETRIES = 3;
const SERVER_RETRY_MS = 30_000;
const RATE_LIMIT_RETRY_MS = 60_000;

function retryDelay(error: unknown): number | null {
  if (!(error instanceof SourceUnavailableError)) return null;
  if (error.status === 429) return error.retryAt === undefined ? RATE_LIMIT_RETRY_MS : Math.max(0, error.retryAt - Date.now());
  if (error.status === undefined || error.status >= 500) return SERVER_RETRY_MS;
  return null;
}

export interface CharactersReport {
  works: number;
  lastRowid: number;
  returned: number;
  withPeople: number;
  quizReady: number;
  gatedOut: number;
  rows: { person: number; place: number; time: number };
  sample: Array<{ key: string; people: string[] }>;
}

async function fetchWithRetries(
  fetchBatch: (works: Array<{ key: string; author: string }>) => Promise<Map<string, CleanedSubjects>>,
  works: Array<{ key: string; author: string }>,
  start: number,
  sleep: Sleep,
  log: (line: string) => void
): Promise<Map<string, CleanedSubjects>> {
  for (let retry = 1; ; retry++) {
    try {
      return await fetchBatch(works);
    } catch (error) {
      const delay = retryDelay(error);
      if (delay === null || retry > CHARACTER_RETRIES) throw error;
      log(JSON.stringify({ retry, of: CHARACTER_RETRIES, batchStart: start, waitMs: delay, error: (error as Error).message }));
      await sleep(delay);
    }
  }
}

export async function fillCharacters(
  repo: Pick<BooksRepository, "transaction" | "worksWithOpenLibraryKey" | "replaceWorkSubjects">,
  fetchBatch: (works: Array<{ key: string; author: string }>) => Promise<Map<string, CleanedSubjects>>,
  at: string,
  { dryRun, log, after = 0, sleep = realSleep }: { dryRun: boolean; log: (line: string) => void; after?: number; sleep?: Sleep }
): Promise<CharactersReport> {
  const works = repo.worksWithOpenLibraryKey().filter(({ rowid }) => rowid > after);
  const report: CharactersReport = { works: works.length, lastRowid: after, returned: 0, withPeople: 0, quizReady: 0, gatedOut: 0, rows: { person: 0, place: 0, time: 0 }, sample: [] };
  for (let start = 0; start < works.length; start += CHARACTER_BATCH) {
    const batch = works.slice(start, start + CHARACTER_BATCH);
    const found = await fetchWithRetries(fetchBatch, batch.map(({ olWorkKey, author }) => ({ key: olWorkKey, author })), start, sleep, log);
    const writes: Array<{ id: string; subjects: CleanedSubjects["subjects"] }> = [];
    for (const { id, olWorkKey } of batch) {
      const cleaned = found.get(olWorkKey);
      if (!cleaned) continue;
      const { subjects, gatedOut } = cleaned;
      report.returned++;
      if (gatedOut) report.gatedOut++;
      if (subjects.person.length > 0) {
        report.withPeople++;
        if (subjects.person.length >= 3) report.quizReady++;
        if (report.sample.length < 20) report.sample.push({ key: olWorkKey, people: subjects.person.slice(0, 5) });
      }
      report.rows.person += subjects.person.length;
      report.rows.place += subjects.place.length;
      report.rows.time += subjects.time.length;
      writes.push({ id, subjects });
    }
    if (!dryRun) repo.transaction(() => writes.forEach(({ id, subjects }) => repo.replaceWorkSubjects(id, subjects, at)));
    report.lastRowid = batch[batch.length - 1]!.rowid;
    log(JSON.stringify({ done: Math.min(start + CHARACTER_BATCH, works.length), of: works.length, returned: report.returned, lastRowid: report.lastRowid }));
  }
  return report;
}
