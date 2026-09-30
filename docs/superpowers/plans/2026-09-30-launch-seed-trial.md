# Launch Seed — Plan 1: Seed List + ISBNdb Trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ranked 40,000-book seed list from Open Library, and measure on its 2,000 most popular books whether an ISBNdb subscription adds enough covers to be worth paying for. Nothing from ISBNdb is stored.

**Architecture:** Two pure, tested modules live in the backend `books` module (`seed/`). One parses Open Library's ranked search into seed entries. The other summarises trial results. Two thin `tsx` scripts in `backend/scripts/` drive them against the real APIs. The trial reuses the production cover chain (`findBestCover`, the source adapters, `encodeCover`), so "found a cover" means exactly what it means in production. It writes only widths and source names, never URLs or images.

**Tech Stack:** Node 26, TypeScript run with `tsx`, `node:test`. Existing books-module adapters (`fetchJson`, `createThrottle`, `createAppleSource`, `createIsbndbSource`, `createOpenLibraryCoverSource`, `encodeCover`, `findBestCover`).

**Spec:** the **Decisions** section below. It was agreed in chat on 2026-09-30, and there is no separate spec file.

## Decisions (agreed 2026-09-30)

- **Seed size:** 40,000 books. 35,000 most popular (English editions) + 5,000 reserved for Portuguese editions, ranked by Open Library `readinglog_count`.
- **List source:** Open Library search API (`sort=readinglog`, `lang=` picks an edition in that language with ISBNs). It's CC0, so no licence ties. It's ~45 requests, not the 12 GB dumps.
- **Quality over speed.** Target order for the production chain (Plan 3): Apple first, ISBNdb for gaps and fallback, Open Library last.
- **ISBNdb is on a trial plan.** Its terms require deleting stored ISBNdb data when the subscription ends, so this plan stores **nothing** from ISBNdb: no images and no URLs, only measured widths.
- **Trial sample:** the 2,000 most popular books from the list, 10% Portuguese (1,800 English + 200 Portuguese).
- **"Worth it" means** ISBNdb gives a ≥400px cover where Apple + Open Library give none or <400px. The report projects that to the 40k seed per language.
- **Overlap the lookups.** Each book's free pass and ISBNdb pass run at the same time, and 4 books are in flight at once. Each source keeps its own throttle, so no rate limit changes. The run is bounded by Apple alone: ~2–3 h instead of ~3.5–5.5 h.
- **Run in the cloud.** A manually triggered GitHub Actions workflow runs the trial, so the user's PC can be off. The ISBNdb key is a repository secret (`ISBNDB_API_KEY`) that the user sets. Progress is kept in the Actions cache so a rerun resumes. Results (widths only) are uploaded as an artifact.

## Where this plan fits (launch roadmap)

This is plan 1 of 5. Each later plan gets its own document when it is reached:

1. **This plan:** seed list + ISBNdb trial. It's time-boxed by the ISBNdb trial.
2. **All images to R2.** Covers, gallery and avatars behind one R2 blob store. Old `/covers/cached` URLs may break (the app is pre-launch). The user creates the bucket, the `covers.atmyshelf.com` domain and keys, and sets the Railway variables.
3. **Chain order + ISBNdb warning.** Apple → ISBNdb → Open Library for the exact edition. ISBNdb is used only if the trial says so and the plan is paid. On a 401/403 from ISBNdb, stop calling it and email the admin once (Resend), with the count of stored `source = 'isbndb'` covers.
4. **Seed runner.** An admin-only way to push the list into the cover queue (back of queue). It resumes through deploys via the boot backfill (`enqueueUnchecked`, PR #76). Genres come from the list's `subjects`.
5. **Coverage measurement.** The share of a real imported library the catalog already covers, re-run after seeding.

## Global Constraints

- Minimum code, no code comments, no new dependencies (root `AGENTS.md`).
- Catch only the specific error you expect. `SourceUnavailableError` (timeouts, 429, 5xx) must **never** be recorded as "no cover". A book whose lookup was incomplete is skipped and retried on the next run.
- Stay polite to external APIs:
  - Open Library search: 1 request/second, `User-Agent: Atmyshelf/1.0 (book covers)` (already set by `fetchJson`).
  - Apple: `APPLE_GAP_MS` 3,200 ms.
  - ISBNdb: `ISBNDB_GAP_MS` 1,100 ms.
- Script outputs go under `backend/data/seed/`, which `backend/.gitignore` already ignores via `data/`. Nothing is committed from a run.
- The trial output never contains ISBNdb URLs, image bytes, or ISBNdb metadata. Only `isbn`, `lang`, widths, and source names.
- Every new `*.test.ts` file must be added to the explicit list in `backend/package.json` `"test"`, or CI won't run it (`backend/AGENTS.md`).
- Backend tests run with `DOTENV_CONFIG_PATH=/nonexistent/.env` so a local `.env` can't mask a failure.

## Review Focus

1. **ISBNdb quota exhaustion or 429 mid-run.** The run must stop recording, not log 1,000 fake "ISBNdb missed" rows. Pinned by the Task 3 test "an incomplete ISBNdb pass is not recorded".
2. **Restarting the multi-hour trial after a crash or Ctrl-C.** Books already in the output are skipped, so ISBNdb calls aren't spent twice. Pinned by the Task 3 test "resume skips isbns already recorded".
3. **A work with no edition, or no ISBN, in the requested language.** It is skipped rather than producing an entry with an empty ISBN. Pinned by the Task 1 test "skips works without an ISBN in that language".
4. **The same ISBN appearing in both the Portuguese and English lists, or twice across pages.** The final list has each ISBN once, and the Portuguese reservation keeps it. Pinned by the Task 2 test "dedupes by ISBN, Portuguese first".
5. **ISBNdb's 200×248 placeholder image.** It must not count as "ISBNdb found a cover". This is covered by reusing `findBestCover` and its `isAcceptableCover`, and pinned by the Task 3 test "the ISBNdb placeholder is not a find".

---

### Task 1: Parse Open Library's ranked works into seed entries

**Files:**
- Create: `backend/src/modules/books/seed/rankedWorks.ts`
- Test: `backend/src/modules/books/seed/rankedWorks.test.ts`
- Modify: `backend/package.json` (add the test file to `"test"`)

**Interfaces:**
- Produces:
  - `type SeedLanguage = "eng" | "por"`
  - `interface SeedEntry { isbn: string; title: string; author: string; lang: SeedLanguage; workKey: string; readers: number; subjects: string[] }`
  - `rankedWorksUrl(lang: SeedLanguage, offset: number, limit: number): string`
  - `parseRankedWorks(json: unknown, lang: SeedLanguage): SeedEntry[]`

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRankedWorks, rankedWorksUrl } from "./rankedWorks.js";

const page = {
  docs: [
    {
      key: "/works/OL17930368W",
      title: "Atomic Habits",
      author_name: ["James Clear"],
      readinglog_count: 63264,
      subject: ["Habit", "Self-help", 42],
      editions: { docs: [{ key: "/books/OL40216430M", title: "Hábitos Atômicos", language: ["por"], isbn: ["8550807567", "9788550807560"] }] }
    },
    { key: "/works/OL1W", title: "No Edition", author_name: ["A"], readinglog_count: 10, editions: { docs: [] } },
    { key: "/works/OL2W", title: "Bad Isbn", author_name: ["B"], readinglog_count: 9, editions: { docs: [{ title: "Bad Isbn", isbn: ["123"] }] } }
  ]
};

test("builds an entry from the language edition, preferring ISBN-13 and the edition title", () => {
  assert.deepEqual(parseRankedWorks(page, "por")[0], {
    isbn: "9788550807560",
    title: "Hábitos Atômicos",
    author: "James Clear",
    lang: "por",
    workKey: "/works/OL17930368W",
    readers: 63264,
    subjects: ["Habit", "Self-help"]
  });
});

test("skips works without an ISBN in that language", () => {
  assert.equal(parseRankedWorks(page, "por").length, 1);
});

test("falls back to ISBN-10 and the work title when the edition has only those", () => {
  const entries = parseRankedWorks({ docs: [{ key: "/works/OL3W", title: "Work Title", author_name: ["C"], readinglog_count: 1, editions: { docs: [{ isbn: ["0306406152"] }] } }] }, "eng");
  assert.equal(entries[0]?.isbn, "0306406152");
  assert.equal(entries[0]?.title, "Work Title");
});

test("ignores malformed pages", () => {
  assert.deepEqual(parseRankedWorks("nonsense", "eng"), []);
  assert.deepEqual(parseRankedWorks({ docs: [null, 3] }, "eng"), []);
});

test("asks Open Library for that language's editions, ranked by reading log", () => {
  const url = new URL(rankedWorksUrl("por", 2000, 1000));
  assert.equal(url.origin + url.pathname, "https://openlibrary.org/search.json");
  assert.equal(url.searchParams.get("q"), "language:por");
  assert.equal(url.searchParams.get("lang"), "por");
  assert.equal(url.searchParams.get("sort"), "readinglog");
  assert.equal(url.searchParams.get("offset"), "2000");
  assert.equal(url.searchParams.get("limit"), "1000");
});
```

- [ ] **Step 2: Add the test file to `backend/package.json` and run it to verify it fails**

Append ` src/modules/books/seed/rankedWorks.test.ts` to the end of the `"test"` script's file list, then run:

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/rankedWorks.test.ts`
Expected: FAIL, `Cannot find module './rankedWorks.js'`

- [ ] **Step 3: Write the minimal implementation**

```ts
import { normalizeIsbn } from "@scripta/shared";

export type SeedLanguage = "eng" | "por";

export interface SeedEntry {
  isbn: string;
  title: string;
  author: string;
  lang: SeedLanguage;
  workKey: string;
  readers: number;
  subjects: string[];
}

const MAX_SUBJECTS = 10;
const FIELDS = "key,title,author_name,readinglog_count,subject,editions,editions.title,editions.isbn,editions.language";

export function rankedWorksUrl(lang: SeedLanguage, offset: number, limit: number): string {
  const params = new URLSearchParams({ q: `language:${lang}`, lang, sort: "readinglog", offset: String(offset), limit: String(limit), fields: FIELDS });
  return `https://openlibrary.org/search.json?${params}`;
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

function pickIsbn(raw: string[]): string {
  const valid = raw.map(normalizeIsbn).filter(Boolean);
  return valid.find((isbn) => isbn.length === 13) ?? valid[0] ?? "";
}

export function parseRankedWorks(json: unknown, lang: SeedLanguage): SeedEntry[] {
  const docs = json && typeof json === "object" ? (json as { docs?: unknown }).docs : undefined;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const work = item as Record<string, unknown>;
    const editions = work.editions && typeof work.editions === "object" ? (work.editions as { docs?: unknown }).docs : undefined;
    const edition = Array.isArray(editions) && editions[0] && typeof editions[0] === "object" ? (editions[0] as Record<string, unknown>) : null;
    const isbn = edition ? pickIsbn(strings(edition.isbn)) : "";
    const title = (typeof edition?.title === "string" && edition.title) || (typeof work.title === "string" ? work.title : "");
    const author = strings(work.author_name)[0] ?? "";
    if (!isbn || !title || typeof work.key !== "string") return [];
    return [{
      isbn,
      title,
      author,
      lang,
      workKey: work.key,
      readers: typeof work.readinglog_count === "number" ? work.readinglog_count : 0,
      subjects: strings(work.subject).slice(0, MAX_SUBJECTS)
    }];
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/rankedWorks.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `cd backend && npm run typecheck`
Expected: no output, exit 0

```bash
git add backend/src/modules/books/seed/rankedWorks.ts backend/src/modules/books/seed/rankedWorks.test.ts backend/package.json && git commit -m "Parse Open Library's reading-log ranking into seed entries" -m "Open Library's search API ranks works by readinglog_count and, given lang=, returns an edition in that language with its ISBNs, so the launch seed list needs ~45 requests instead of the 12 GB dumps. ISBN-13 is preferred and works without an ISBN in the language are skipped, since the catalog keys books by ISBN.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Build the 40k seed list (script + merge rule)

**Files:**
- Create: `backend/src/modules/books/seed/seedList.ts`
- Test: `backend/src/modules/books/seed/seedList.test.ts`
- Create: `backend/scripts/build-seed-list.ts`
- Modify: `backend/package.json` (add the test file to `"test"`)

**Interfaces:**
- Consumes: `SeedEntry`, `SeedLanguage`, `rankedWorksUrl`, `parseRankedWorks` (Task 1). `fetchJson(source, url)` and `createThrottle(ms)` from `backend/src/modules/books/adapters/http/http.ts`.
- Produces:
  - `mergeSeedLists(portuguese: SeedEntry[], english: SeedEntry[], counts: { por: number; eng: number }): SeedEntry[]`. Portuguese first, deduped by ISBN, each list capped at its count.
  - The file `backend/data/seed/seed-list.jsonl`, one `SeedEntry` JSON per line, most popular first within each language, Portuguese block first.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { SeedEntry } from "./rankedWorks.js";
import { mergeSeedLists } from "./seedList.js";

const entry = (isbn: string, lang: "eng" | "por"): SeedEntry => ({ isbn, title: isbn, author: "A", lang, workKey: `/works/${isbn}`, readers: 1, subjects: [] });

test("dedupes by ISBN, Portuguese first", () => {
  const merged = mergeSeedLists([entry("1", "por"), entry("2", "por")], [entry("2", "eng"), entry("3", "eng")], { por: 5, eng: 5 });
  assert.deepEqual(merged.map((e) => `${e.lang}:${e.isbn}`), ["por:1", "por:2", "eng:3"]);
});

test("caps each language at its count, counting only unique entries", () => {
  const merged = mergeSeedLists([entry("1", "por"), entry("1", "por"), entry("2", "por"), entry("3", "por")], [entry("4", "eng"), entry("5", "eng")], { por: 2, eng: 1 });
  assert.deepEqual(merged.map((e) => e.isbn), ["1", "2", "4"]);
});
```

- [ ] **Step 2: Add the test file to `backend/package.json` and run it to verify it fails**

Append ` src/modules/books/seed/seedList.test.ts` to the `"test"` script's file list.

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/seedList.test.ts`
Expected: FAIL, `Cannot find module './seedList.js'`

- [ ] **Step 3: Write the minimal implementation**

`backend/src/modules/books/seed/seedList.ts`:

```ts
import type { SeedEntry } from "./rankedWorks.js";

export function mergeSeedLists(portuguese: SeedEntry[], english: SeedEntry[], counts: { por: number; eng: number }): SeedEntry[] {
  const seen = new Set<string>();
  const take = (entries: SeedEntry[], limit: number) => {
    const kept: SeedEntry[] = [];
    for (const entry of entries) {
      if (kept.length >= limit) break;
      if (seen.has(entry.isbn)) continue;
      seen.add(entry.isbn);
      kept.push(entry);
    }
    return kept;
  };
  return [...take(portuguese, counts.por), ...take(english, counts.eng)];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/seedList.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the script**

`backend/scripts/build-seed-list.ts`. It fetches pages until each language has enough unique entries or Open Library runs out, at 1 request/second, then writes the merged list.

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createThrottle, fetchJson } from "../src/modules/books/adapters/http/http.js";
import { parseRankedWorks, rankedWorksUrl, type SeedEntry, type SeedLanguage } from "../src/modules/books/seed/rankedWorks.js";
import { mergeSeedLists } from "../src/modules/books/seed/seedList.js";

const PAGE = 1000;
const { values } = parseArgs({ options: { eng: { type: "string", default: "35000" }, por: { type: "string", default: "5000" }, out: { type: "string", default: "data/seed/seed-list.jsonl" } } });
const counts = { eng: Number(values.eng), por: Number(values.por) };
const throttle = createThrottle(1000);

async function collect(lang: SeedLanguage, wanted: number): Promise<SeedEntry[]> {
  const entries: SeedEntry[] = [];
  const isbns = new Set<string>();
  for (let offset = 0; isbns.size < wanted * 1.1; offset += PAGE) {
    const page = parseRankedWorks(await throttle(() => fetchJson("openlibrary", rankedWorksUrl(lang, offset, PAGE))), lang);
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
```

The `wanted * 1.1` margin covers English ISBNs later dropped as duplicates of Portuguese ones.

- [ ] **Step 6: Run the script for real**

Run: `cd backend && npx tsx scripts/build-seed-list.ts`
Expected: progress lines on stderr, ending with `wrote 40000 entries (5000 por, 35000 eng) to data/seed/seed-list.jsonl`. It takes roughly 45 pages × ~5 s ≈ 4 minutes. If Open Library runs out of Portuguese works with ISBNs before 5,000, the count shows fewer. Report the real numbers; don't pad.

Then spot-check:

Run: `cd backend && head -3 data/seed/seed-list.jsonl && sed -n '5001p' data/seed/seed-list.jsonl`
Expected: the first lines are Portuguese editions of very popular works (e.g. "Hábitos Atômicos"). Line 5001 is the most popular English entry.

- [ ] **Step 7: Typecheck and commit (code only; the list is ignored)**

Run: `cd backend && npm run typecheck && git status --short`
Expected: typecheck clean. `git status` shows no `data/` files.

```bash
git add backend/src/modules/books/seed/seedList.ts backend/src/modules/books/seed/seedList.test.ts backend/scripts/build-seed-list.ts backend/package.json && git commit -m "Build the 40k launch seed list from Open Library's reading-log ranking" -m "35,000 most popular English editions plus 5,000 reserved for Portuguese editions, deduped by ISBN with the Portuguese reservation winning. Output goes to the ignored backend/data/seed/ so no run is committed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The ISBNdb trial (stores nothing)

**Files:**
- Create: `backend/src/modules/books/seed/trial.ts`
- Test: `backend/src/modules/books/seed/trial.test.ts`
- Create: `backend/scripts/cover-source-trial.ts`
- Modify: `backend/package.json` (add the test file to `"test"`)

**Interfaces:**
- Consumes:
  - `SeedEntry` (Task 1), and the `backend/data/seed/seed-list.jsonl` file (Task 2).
  - `findBestCover(book, rejected, sources, fetchImage): Promise<CoverOutcome>` and the `CoverSources`, `FetchCoverImage` types from `backend/src/modules/books/coverResolver.ts`.
  - `createAppleSource`, `createIsbndbSource`, `createOpenLibraryCoverSource`, `createThrottle`, `fetchBytes`, `encodeCover`.
- Produces:
  - `interface TrialRow { isbn: string; lang: SeedLanguage; free: { source: string; width: number } | null; isbndb: { width: number } | null }`
  - `trialBook(entry: SeedEntry, freeSources: CoverSources, isbndbOnly: CoverSources, fetchImage: FetchCoverImage): Promise<TrialRow | null>`. It returns `null` when either pass was incomplete (a source was unavailable).
  - `pendingEntries(entries: SeedEntry[], recorded: Set<string>): SeedEntry[]`
  - `summarizeTrial(rows: TrialRow[], seedCounts: { eng: number; por: number }): TrialSummary`
  - `interface TrialSummary { byLang: Record<SeedLanguage, LangSummary>; projectedGapFills: number }`
  - `interface LangSummary { books: number; freeGood: number; isbndbGood: number; gapFills: number; isbndbWider: number; noCover: number }`

"Good" means `width >= MIN_GOOD_WIDTH` (400). A `gapFill` is a book where the free chain has no cover or <400px and ISBNdb has ≥400px. `isbndbWider` counts books where both have a cover and ISBNdb's is wider. `projectedGapFills` = Σ over languages of `gapFills / books × seedCounts[lang]`, rounded.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { CoverSources, FetchCoverImage } from "../coverResolver.js";
import { SourceUnavailableError } from "../domain/errors.js";
import type { CoverSource } from "../domain/ports.js";
import type { SeedEntry } from "./rankedWorks.js";
import { pendingEntries, summarizeTrial, trialBook, type TrialRow } from "./trial.js";

const entry: SeedEntry = { isbn: "9780306406157", title: "Dune", author: "Frank Herbert", lang: "eng", workKey: "/works/OL1W", readers: 1, subjects: [] };
const none: CoverSource = { byIsbn: async () => [], byTitle: async () => [] };
const giving = (source: "apple" | "isbndb" | "openlibrary", url: string): CoverSource => ({ byIsbn: async () => [{ source, url }], byTitle: async () => [] });
const failing: CoverSource = { byIsbn: async () => { throw new SourceUnavailableError("isbndb", "HTTP 429"); }, byTitle: async () => [] };
const sized = (sizes: Record<string, [number, number]>): FetchCoverImage => async (candidate) => {
  const size = sizes[candidate.url];
  return size ? { full: Buffer.alloc(0), thumb: Buffer.alloc(0), width: size[0], height: size[1] } : null;
};

test("records the free chain's cover and ISBNdb's width separately", async () => {
  const free: CoverSources = { isbndb: null, apple: giving("apple", "a"), openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: giving("isbndb", "i"), apple: none, openlibrary: none };
  const row = await trialBook(entry, free, isbndbOnly, sized({ a: [300, 450], i: [500, 750] }));
  assert.deepEqual(row, { isbn: entry.isbn, lang: "eng", free: { source: "apple", width: 300 }, isbndb: { width: 500 } });
});

test("the ISBNdb placeholder is not a find", async () => {
  const free: CoverSources = { isbndb: null, apple: none, openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: giving("isbndb", "p"), apple: none, openlibrary: none };
  const row = await trialBook(entry, free, isbndbOnly, sized({ p: [200, 248] }));
  assert.equal(row?.isbndb, null);
});

test("an incomplete ISBNdb pass is not recorded", async () => {
  const free: CoverSources = { isbndb: null, apple: giving("apple", "a"), openlibrary: none };
  const isbndbOnly: CoverSources = { isbndb: failing, apple: none, openlibrary: none };
  assert.equal(await trialBook(entry, free, isbndbOnly, sized({ a: [600, 900] })), null);
});

test("resume skips isbns already recorded", () => {
  const other = { ...entry, isbn: "9780000000002" };
  assert.deepEqual(pendingEntries([entry, other], new Set([entry.isbn])), [other]);
});

test("summarizes per language and projects gap fills to the seed", () => {
  const rows: TrialRow[] = [
    { isbn: "1", lang: "eng", free: { source: "apple", width: 900 }, isbndb: { width: 1000 } },
    { isbn: "2", lang: "eng", free: { source: "openlibrary", width: 300 }, isbndb: { width: 500 } },
    { isbn: "3", lang: "por", free: null, isbndb: { width: 450 } },
    { isbn: "4", lang: "por", free: null, isbndb: null }
  ];
  const summary = summarizeTrial(rows, { eng: 35000, por: 5000 });
  assert.deepEqual(summary.byLang.eng, { books: 2, freeGood: 1, isbndbGood: 2, gapFills: 1, isbndbWider: 2, noCover: 0 });
  assert.deepEqual(summary.byLang.por, { books: 2, freeGood: 0, isbndbGood: 1, gapFills: 1, isbndbWider: 0, noCover: 1 });
  assert.equal(summary.projectedGapFills, 17500 + 2500);
});
```

- [ ] **Step 2: Add the test file to `backend/package.json` and run it to verify it fails**

Append ` src/modules/books/seed/trial.test.ts` to the `"test"` script's file list.

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/trial.test.ts`
Expected: FAIL, `Cannot find module './trial.js'`

- [ ] **Step 3: Write the minimal implementation**

`backend/src/modules/books/seed/trial.ts`:

```ts
import { findBestCover, type CoverSources, type FetchCoverImage } from "../coverResolver.js";
import { MIN_GOOD_WIDTH } from "../domain/constants.js";
import type { SeedEntry, SeedLanguage } from "./rankedWorks.js";

export interface TrialRow {
  isbn: string;
  lang: SeedLanguage;
  free: { source: string; width: number } | null;
  isbndb: { width: number } | null;
}

export interface LangSummary {
  books: number;
  freeGood: number;
  isbndbGood: number;
  gapFills: number;
  isbndbWider: number;
  noCover: number;
}

export interface TrialSummary {
  byLang: Record<SeedLanguage, LangSummary>;
  projectedGapFills: number;
}

export async function trialBook(entry: SeedEntry, freeSources: CoverSources, isbndbOnly: CoverSources, fetchImage: FetchCoverImage): Promise<TrialRow | null> {
  const book = { isbn: entry.isbn, title: entry.title, author: entry.author };
  const [free, isbndb] = await Promise.all([
    findBestCover(book, new Set(), freeSources, fetchImage),
    findBestCover(book, new Set(), isbndbOnly, fetchImage)
  ]);
  if (!free.complete || !isbndb.complete) return null;
  return {
    isbn: entry.isbn,
    lang: entry.lang,
    free: free.found ? { source: free.found.candidate.source, width: free.found.image.width } : null,
    isbndb: isbndb.found ? { width: isbndb.found.image.width } : null
  };
}

export function pendingEntries(entries: SeedEntry[], recorded: Set<string>): SeedEntry[] {
  return entries.filter((entry) => !recorded.has(entry.isbn));
}

const empty = (): LangSummary => ({ books: 0, freeGood: 0, isbndbGood: 0, gapFills: 0, isbndbWider: 0, noCover: 0 });

export function summarizeTrial(rows: TrialRow[], seedCounts: { eng: number; por: number }): TrialSummary {
  const byLang: Record<SeedLanguage, LangSummary> = { eng: empty(), por: empty() };
  for (const row of rows) {
    const s = byLang[row.lang];
    const freeGood = (row.free?.width ?? 0) >= MIN_GOOD_WIDTH;
    const isbndbGood = (row.isbndb?.width ?? 0) >= MIN_GOOD_WIDTH;
    s.books++;
    if (freeGood) s.freeGood++;
    if (isbndbGood) s.isbndbGood++;
    if (!freeGood && isbndbGood) s.gapFills++;
    if (row.free && row.isbndb && row.isbndb.width > row.free.width) s.isbndbWider++;
    if (!row.free && !row.isbndb) s.noCover++;
  }
  const projectedGapFills = (["eng", "por"] as const).reduce((sum, lang) => sum + (byLang[lang].books ? (byLang[lang].gapFills / byLang[lang].books) * seedCounts[lang] : 0), 0);
  return { byLang, projectedGapFills: Math.round(projectedGapFills) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && DOTENV_CONFIG_PATH=/nonexistent/.env npx tsx --test src/modules/books/seed/trial.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the script**

`backend/scripts/cover-source-trial.ts` works like this:
- It reads the seed list and takes the first `--por 200` Portuguese and `--eng 1800` English entries.
- It appends one `TrialRow` JSON line per finished book to `data/seed/trial-rows.jsonl` (resumable), and prints the summary at the end.
- It reads `ISBNDB_API_KEY` from the environment and does not import `config/env.ts`, which exits without the full server env.
- It stops after 5 consecutive incomplete books, so an exhausted quota doesn't spin for hours.
- It keeps 4 books in flight. The per-source throttles are shared across them, so every source stays at its own spacing and total time is bounded by Apple's.
- It writes the summary to `data/seed/trial-summary.json`, as well as printing it, so the workflow in Task 4 can upload it.

```ts
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
```

- [ ] **Step 6: Typecheck, run the whole backend suite, and commit**

Run: `cd backend && npm run typecheck && DOTENV_CONFIG_PATH=/nonexistent/.env npm test 2>&1 | grep -E '^ℹ (tests|pass|fail)'`
Expected: typecheck clean, `fail 0`, and the pass count is the previous total + 12.

```bash
git add backend/src/modules/books/seed/trial.ts backend/src/modules/books/seed/trial.test.ts backend/scripts/cover-source-trial.ts backend/package.json && git commit -m "Add a resumable ISBNdb trial that measures gap fills without storing anything" -m "Runs the production cover chain without ISBNdb, then ISBNdb alone, on the 2,000 most popular seed books (10% Portuguese). It records only widths and source names, never ISBNdb URLs or images, because the trial's terms require deleting stored ISBNdb data when it ends. A lookup cut short by a 429/timeout is not recorded, so quota exhaustion can't read as 'ISBNdb has no cover'.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Smoke-run locally on a tiny sample (no ISBNdb spend worth noting)**

Run: `cd backend && npx tsx --env-file=/Users/andreribeiro/Documents/scripta/backend/.env scripts/cover-source-trial.ts --eng 3 --por 2 --out data/seed/smoke-rows.jsonl`
Expected: `5 sampled, 0 already recorded, 5 to go`, then a JSON summary with `books` 3 (eng) and 2 (por). Then `rm backend/data/seed/smoke-rows.jsonl backend/data/seed/trial-summary.json`. If `backend/.env` has no `ISBNDB_API_KEY`, skip this step and say so; the workflow run in Task 4 is the real run.

---

### Task 4: Run the trial in the cloud (GitHub Actions)

**Files:**
- Create: `.github/workflows/cover-trial.yml`

**Interfaces:**
- Consumes: `backend/scripts/build-seed-list.ts` (Task 2), `backend/scripts/cover-source-trial.ts` (Task 3), and the repository secret `ISBNDB_API_KEY` (set by the user).
- Produces: an artifact named `cover-trial` containing `trial-rows.jsonl`, `trial-summary.json` and `seed-list.jsonl`. The Actions cache entry `cover-trial-<run id>` holds `backend/data/seed/` so the next run resumes.

- [ ] **Step 1: Write the workflow**

```yaml
name: Cover source trial

on:
  workflow_dispatch:
    inputs:
      eng:
        description: English books to sample
        default: "1800"
      por:
        description: Portuguese books to sample
        default: "200"

concurrency:
  group: cover-trial
  cancel-in-progress: false

jobs:
  trial:
    runs-on: ubuntu-latest
    timeout-minutes: 340
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 26
          cache: npm
      - run: npm ci
      - run: npm run build --workspace @scripta/shared
      - uses: actions/cache/restore@v4
        with:
          path: backend/data/seed
          key: cover-trial-${{ github.run_id }}
          restore-keys: cover-trial-
      - if: hashFiles('backend/data/seed/seed-list.jsonl') == ''
        run: npx tsx scripts/build-seed-list.ts
        working-directory: backend
      - run: npx tsx scripts/cover-source-trial.ts --eng "${{ inputs.eng }}" --por "${{ inputs.por }}"
        working-directory: backend
        env:
          ISBNDB_API_KEY: ${{ secrets.ISBNDB_API_KEY }}
      - if: always()
        uses: actions/cache/save@v4
        with:
          path: backend/data/seed
          key: cover-trial-${{ github.run_id }}
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cover-trial
          path: |
            backend/data/seed/trial-rows.jsonl
            backend/data/seed/trial-summary.json
            backend/data/seed/seed-list.jsonl
          if-no-files-found: warn
```

`timeout-minutes: 340` stays under GitHub's 6-hour job cap, so the cache-save step still runs if the trial is slow. A rerun then continues where the cache left off.

- [ ] **Step 2: Validate and commit**

Run: `npx -y @action-validator/cli .github/workflows/cover-trial.yml`
Expected: exit 0 with no errors. If that tool can't be fetched, run `node -e "require('node:fs').readFileSync('.github/workflows/cover-trial.yml','utf8')"` plus a careful read, and say the schema wasn't machine-checked.

```bash
git add .github/workflows/cover-trial.yml && git commit -m "Run the ISBNdb cover trial as a manual GitHub Actions workflow" -m "A 2–3 hour run shouldn't depend on a laptop staying awake. The ISBNdb key comes from a repository secret, progress lives in the Actions cache so a rerun resumes, and only widths plus the CC0 seed list are uploaded as the artifact.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 3: Get it onto `main` and start it (controller, not implementer)**

`workflow_dispatch` only works once the workflow file is on the default branch. The controller does this:
1. Push the branch and open a PR.
2. Merge it after CI passes. The user has asked for merges in this effort.
3. Once the user confirms the `ISBNDB_API_KEY` secret is set, start the run.

The user sets the secret themselves, because the key value never passes through Claude:

```bash
gh secret set ISBNDB_API_KEY --repo andresribeiro1996/scripta
```

Start and watch:

```bash
gh workflow run cover-trial.yml --repo andresribeiro1996/scripta --ref main
```

---

### Task 5: Report the verdict

**Files:** none (a chat report). Then append the measured numbers to the "Known limitations" section of `backend/README.md`.

- [ ] **Step 1: Fetch the summary**

Run: `gh run download --repo andresribeiro1996/scripta -n cover-trial -D /tmp/cover-trial "$(gh run list --repo andresribeiro1996/scripta --workflow cover-trial.yml --limit 1 --json databaseId --jq '.[0].databaseId')" && cat /tmp/cover-trial/trial-summary.json && wc -l /tmp/cover-trial/trial-rows.jsonl`

If the run stopped early (non-zero exit, fewer than 2,000 rows), rerun the workflow; it resumes from the cache. Report the partial numbers only if the user asks.

- [ ] **Step 2: Report to the user, per language**
  - books measured
  - free chain ≥400px %
  - ISBNdb ≥400px %
  - gap fills
  - ISBNdb wider than free
  - no cover from anyone
  - projected gap fills across the 40k seed

  **Verdict rule to state explicitly:** worth subscribing if projected gap fills ≥ 1,000 books across the seed. Below that, not worth it. Say which side it lands on and by how much.

- [ ] **Step 3: Record the numbers**

Add one bullet to `backend/README.md` → `#### Known limitations of covers, details and search…`, under the ISBNdb/throughput bullet, with the date and the per-language gap-fill rates.

```bash
git add backend/README.md && git commit -m "Record the ISBNdb trial's measured gap-fill rates" -m "So the subscribe/don't decision and Plan 3's chain order rest on measured numbers a later session can find.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
