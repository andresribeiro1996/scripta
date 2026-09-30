import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { CoverSources, FetchCoverImage } from "../src/modules/books/coverResolver.js";
import { createThrottle, fetchBytes } from "../src/modules/books/adapters/http/http.js";
import { createAppleSource } from "../src/modules/books/adapters/sources/apple.js";
import { createIsbndbSource } from "../src/modules/books/adapters/sources/isbndb.js";
import { createOpenLibraryCoverSource } from "../src/modules/books/adapters/sources/openLibrary.js";
import { encodeCover } from "../src/modules/books/domain/images.js";
import type { CoverSource } from "../src/modules/books/domain/ports.js";
import type { SeedEntry } from "../src/modules/books/seed/rankedWorks.js";
import { pendingEntries, summarizeTrial, trialBook, type TrialRow } from "../src/modules/books/seed/trial.js";

const MAX_CONSECUTIVE_INCOMPLETE = 5;
const { values } = parseArgs({ options: {
  list: { type: "string", default: "data/seed/seed-list.jsonl" },
  out: { type: "string", default: "data/seed/trial-rows.jsonl" },
  eng: { type: "string", default: "1800" },
  por: { type: "string", default: "200" }
} });
const apiKey = process.env.ISBNDB_API_KEY;
if (!apiKey) throw new Error("Set ISBNDB_API_KEY (e.g. npx tsx --env-file=<path to backend/.env> scripts/cover-source-trial.ts).");

const readJsonl = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T) : []);
const list = readJsonl<SeedEntry>(values.list);
const sample = [...list.filter((e) => e.lang === "por").slice(0, Number(values.por)), ...list.filter((e) => e.lang === "eng").slice(0, Number(values.eng))];
const recorded = new Set(readJsonl<TrialRow>(values.out).map((row) => row.isbn));
const todo = pendingEntries(sample, recorded);

const openLibraryCoverThrottle = createThrottle(3100);
const fetchImage: FetchCoverImage = async (candidate) => {
  const bytes = candidate.source === "openlibrary"
    ? await openLibraryCoverThrottle(() => fetchBytes(candidate.source, candidate.url))
    : await fetchBytes(candidate.source, candidate.url);
  return bytes ? encodeCover(bytes) : null;
};
const none: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };
const freeSources: CoverSources = { isbndb: null, apple: createAppleSource(createThrottle(3200)), openlibrary: createOpenLibraryCoverSource(createThrottle(1000)) };
const isbndbOnly: CoverSources = { isbndb: createIsbndbSource(apiKey, createThrottle(1100)), apple: none, openlibrary: none };

console.error(`${sample.length} sampled, ${recorded.size} already recorded, ${todo.length} to go`);
const IN_FLIGHT = 4;
let next = 0;
let done = 0;
let incomplete = 0;
let stopped = false;

async function worker() {
  while (!stopped && next < todo.length) {
    const entry = todo[next++]!;
    const row = await trialBook(entry, freeSources, isbndbOnly, fetchImage);
    if (!row) {
      incomplete++;
      console.error(`incomplete: ${entry.isbn} (${incomplete} in a row)`);
      if (incomplete >= MAX_CONSECUTIVE_INCOMPLETE) stopped = true;
      continue;
    }
    incomplete = 0;
    appendFileSync(values.out, JSON.stringify(row) + "\n");
    if (++done % 50 === 0) console.error(`${done}/${todo.length}`);
  }
}

await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
const summary = JSON.stringify(summarizeTrial(readJsonl<TrialRow>(values.out), { eng: 35000, por: 5000 }), null, 1);
writeFileSync("data/seed/trial-summary.json", summary + "\n");
console.log(summary);
if (stopped) {
  console.error("Stopped early: a source keeps failing (quota or outage). Rerun to resume.");
  process.exit(1);
}
