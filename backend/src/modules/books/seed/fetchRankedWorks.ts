import { USER_AGENT, createThrottle } from "../adapters/http/http.js";
import { PORTUGAL_ISBN13_PREFIXES } from "../domain/normalize.js";
import { parseRankedWorks, rankedWorksUrl, type SeedEntry, type SeedLanguage } from "./rankedWorks.js";

const PAGE = 1000;
const TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 120_000];
const throttle = createThrottle(1000);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function docsOf(json: unknown): unknown[] {
  const docs = json && typeof json === "object" ? (json as { docs?: unknown }).docs : undefined;
  return Array.isArray(docs) ? docs : [];
}

function emptyBeforeTheEnd(json: unknown): boolean {
  const { numFound, start } = (json && typeof json === "object" ? json : {}) as { numFound?: unknown; start?: unknown };
  return docsOf(json).length === 0 && typeof numFound === "number" && typeof start === "number" && start < numFound;
}

async function fetchPage(url: string, log: (line: string) => void): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let failure: Error;
    let reason: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const json = await res.json();
        if (!emptyBeforeTheEnd(json)) return json;
        failure = new Error(`Open Library returned no results before the end of the list for ${url}`);
        reason = "empty page";
      } else {
        failure = new Error(`Open Library HTTP ${res.status} for ${url}`);
        if (res.status < 500 && res.status !== 429) throw failure;
        reason = `HTTP ${res.status}`;
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      failure = err;
      reason = "timeout";
    }
    if (attempt === RETRY_DELAYS_MS.length) throw failure;
    log(`retry ${attempt + 1} after ${reason}: ${url}`);
    await sleep(RETRY_DELAYS_MS[attempt]!);
  }
}

async function collectPrefix(lang: SeedLanguage, wanted: number, isbnPrefix: string | undefined, log: (line: string) => void): Promise<SeedEntry[]> {
  const entries: SeedEntry[] = [];
  const isbns = new Set<string>();
  for (let offset = 0; isbns.size < wanted * 1.1; offset += PAGE) {
    const json = await throttle(() => fetchPage(rankedWorksUrl(lang, offset, PAGE, isbnPrefix), log));
    if (docsOf(json).length === 0) break;
    const page = parseRankedWorks(json, lang, isbnPrefix);
    for (const entry of page) if (!isbns.has(entry.isbn)) { isbns.add(entry.isbn); entries.push(entry); }
    log(`${isbnPrefix ?? lang}: offset ${offset}, ${isbns.size} unique`);
  }
  return entries;
}

export async function collectRanked(lang: SeedLanguage, wanted: number, log: (line: string) => void): Promise<SeedEntry[]> {
  if (lang !== "por") return collectPrefix(lang, wanted, undefined, log);
  const byWork = new Map<string, SeedEntry>();
  for (const prefix of PORTUGAL_ISBN13_PREFIXES) {
    for (const entry of await collectPrefix(lang, wanted, prefix, log)) {
      const kept = byWork.get(entry.workKey);
      if (!kept || entry.readers > kept.readers) byWork.set(entry.workKey, entry);
    }
  }
  return [...byWork.values()].sort((a, b) => b.readers - a.readers);
}
