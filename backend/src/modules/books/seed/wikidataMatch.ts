import { canonicalIsbn } from "@scripta/shared";
import { createThrottle, fetchJson } from "../adapters/http/http.js";
import { realSleep, type Sleep } from "../adapters/typesafe/jevRequest.js";
import { reasonOf } from "../adapters/wikidata/sparql.js";
import { SourceUnavailableError } from "../domain/errors.js";
import { normalizeWorkKey } from "../domain/normalize.js";
import type { BooksRepository } from "../domain/ports.js";

const BATCH_SIZE = 300;
const BATCH_PAUSE_MS = 100;
const REDIRECT_HOPS = 2;
const OPEN_LIBRARY_GAP_MS = 1000;
const OPEN_LIBRARY_PROGRESS_EVERY = 100;
const OPEN_LIBRARY_ATTEMPTS = 3;
const OPEN_LIBRARY_RETRY_MS = 60_000;

export async function inBatches<T>(repo: Pick<BooksRepository, "transaction">, items: T[], write: (item: T) => boolean | number): Promise<number> {
  let added = 0;
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    if (start > 0) await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    added += repo.transaction(() => items.slice(start, start + BATCH_SIZE).reduce((total, item) => total + Number(write(item)), 0));
  }
  return added;
}

function redirectTarget(record: unknown): string | null {
  const { type, location } = (record ?? {}) as { type?: { key?: unknown } | null; location?: unknown };
  return type?.key === "/type/redirect" && typeof location === "string" ? normalizeWorkKey(location) : null;
}

export async function followRedirects(
  repo: Pick<BooksRepository, "workIdsByWorkKeys">,
  fetchWork: (olWorkKey: string) => Promise<unknown>,
  olWorkKey: string
): Promise<string | undefined> {
  let current = olWorkKey;
  for (let hop = 0; hop < REDIRECT_HOPS; hop++) {
    const target = redirectTarget(await fetchWork(current));
    if (target === null) return undefined;
    const workId = repo.workIdsByWorkKeys([target]).get(target);
    if (workId) return workId;
    current = target;
  }
  return undefined;
}

export async function matchWorkIds(
  repo: Pick<BooksRepository, "findBookByKey" | "workIdsByWorkKeys">,
  fetchWork: (olWorkKey: string) => Promise<unknown>,
  rows: Array<{ isbns: string[]; olWorkIds: string[] }>
): Promise<{ workIds: Array<Set<string>>; redirected: number; failedKeys: string[] }> {
  const byOpenLibraryKey = repo.workIdsByWorkKeys([...new Set(rows.flatMap((row) => row.olWorkIds))]);
  const unmatchedKeys = new Set<string>();
  for (const row of rows) for (const olKey of row.olWorkIds) if (!byOpenLibraryKey.has(olKey)) unmatchedKeys.add(olKey);
  const fetched = new Map<string, Promise<unknown>>();
  const fetchOnce = (olKey: string) => {
    const answer = fetched.get(olKey) ?? fetchWork(olKey);
    fetched.set(olKey, answer);
    return answer;
  };
  const report = { redirected: 0, failedKeys: [] as string[] };
  for (const olKey of unmatchedKeys) {
    try {
      const workId = await followRedirects(repo, fetchOnce, olKey);
      if (workId === undefined) continue;
      byOpenLibraryKey.set(olKey, workId);
      report.redirected++;
    } catch (error) {
      if (!(error instanceof SourceUnavailableError) || error.status === 429) throw error;
      report.failedKeys.push(olKey);
    }
  }
  const workIds = rows.map((row) => {
    const matched = new Set<string>();
    for (const isbn of row.isbns) {
      const canonical = canonicalIsbn(isbn);
      const workId = canonical ? repo.findBookByKey(`isbn:${canonical}`)?.work_id : null;
      if (workId) matched.add(workId);
    }
    for (const olKey of row.olWorkIds) {
      const workId = byOpenLibraryKey.get(olKey);
      if (workId) matched.add(workId);
    }
    return matched;
  });
  return { workIds, ...report };
}

export function createWorkFetcher({ log, sleep = realSleep }: { log: (line: string) => void; sleep?: Sleep }): (olWorkKey: string) => Promise<unknown> {
  const throttle = createThrottle(OPEN_LIBRARY_GAP_MS, Date.now, sleep);
  let openLibraryRequests = 0;
  let failed = 0;
  const request = async (key: string) => {
    try {
      return await throttle(() => fetchJson("openlibrary", `https://openlibrary.org/works/${key}.json`));
    } catch (error) {
      failed++;
      throw error;
    } finally {
      if (++openLibraryRequests % OPEN_LIBRARY_PROGRESS_EVERY === 0) log(JSON.stringify({ openLibraryRequests, failed }));
    }
  };
  return async (key) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request(key);
      } catch (error) {
        if (!(error instanceof SourceUnavailableError) || error.status !== 429 || attempt === OPEN_LIBRARY_ATTEMPTS) throw error;
        const waitMs = Math.max((error.retryAt ?? 0) - Date.now(), OPEN_LIBRARY_RETRY_MS);
        log(`openlibrary attempt ${attempt} failed (${reasonOf(error)}), retrying in ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }
  };
}
