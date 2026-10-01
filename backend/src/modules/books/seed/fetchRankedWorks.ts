import { setTimeout as sleep } from "node:timers/promises";
import { createThrottle } from "../adapters/http/http.js";
import { parseRankedWorks, rankedWorksUrl, type SeedEntry, type SeedLanguage } from "./rankedWorks.js";

const PAGE = 1000;
const TIMEOUT_MS = 60_000;
const RETRY_DELAYS_MS = [10_000, 30_000];
const throttle = createThrottle(1000);

async function fetchPage(url: string, log: (line: string) => void): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let failure: Error;
    let reason: string;
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Atmyshelf/1.0 (book covers)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) return await res.json();
      failure = new Error(`Open Library HTTP ${res.status} for ${url}`);
      if (res.status < 500 && res.status !== 429) throw failure;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      if (!(err instanceof Error && err.name === "TimeoutError")) throw err;
      failure = err;
      reason = "timeout";
    }
    if (attempt === RETRY_DELAYS_MS.length) throw failure;
    log(`retry ${attempt + 1} after ${reason}: ${url}`);
    await sleep(RETRY_DELAYS_MS[attempt]);
  }
}

export async function collectRanked(lang: SeedLanguage, wanted: number, log: (line: string) => void): Promise<SeedEntry[]> {
  const entries: SeedEntry[] = [];
  const isbns = new Set<string>();
  for (let offset = 0; isbns.size < wanted * 1.1; offset += PAGE) {
    const page = parseRankedWorks(await throttle(() => fetchPage(rankedWorksUrl(lang, offset, PAGE), log)), lang);
    if (page.length === 0) break;
    for (const entry of page) if (!isbns.has(entry.isbn)) { isbns.add(entry.isbn); entries.push(entry); }
    log(`${lang}: offset ${offset}, ${isbns.size} unique`);
  }
  return entries;
}
