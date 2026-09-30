import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createThrottle } from "../src/modules/books/adapters/http/http.js";
import { parseRankedWorks, rankedWorksUrl, type SeedEntry, type SeedLanguage } from "../src/modules/books/seed/rankedWorks.js";
import { mergeSeedLists } from "../src/modules/books/seed/seedList.js";

const PAGE = 1000;
const TIMEOUT_MS = 60_000;
const { values } = parseArgs({ options: { eng: { type: "string", default: "35000" }, por: { type: "string", default: "5000" }, out: { type: "string", default: "data/seed/seed-list.jsonl" } } });
const counts = { eng: Number(values.eng), por: Number(values.por) };
const throttle = createThrottle(1000);

async function fetchPage(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": "Atmyshelf/1.0 (book covers)" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Open Library HTTP ${res.status} for ${url}`);
  return res.json();
}

async function collect(lang: SeedLanguage, wanted: number): Promise<SeedEntry[]> {
  const entries: SeedEntry[] = [];
  const isbns = new Set<string>();
  for (let offset = 0; isbns.size < wanted * 1.1; offset += PAGE) {
    const page = parseRankedWorks(await throttle(() => fetchPage(rankedWorksUrl(lang, offset, PAGE))), lang);
    if (page.length === 0) break;
    for (const entry of page) if (!isbns.has(entry.isbn)) { isbns.add(entry.isbn); entries.push(entry); }
    console.error(`${lang}: offset ${offset}, ${isbns.size} unique`);
  }
  return entries;
}

const merged = mergeSeedLists(await collect("por", counts.por), await collect("eng", counts.eng), counts);
mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, merged.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
const por = merged.filter((entry) => entry.lang === "por").length;
console.error(`wrote ${merged.length} entries (${por} por, ${merged.length - por} eng) to ${values.out}`);
