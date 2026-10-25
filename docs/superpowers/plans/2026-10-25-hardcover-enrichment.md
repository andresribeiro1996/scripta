# Hardcover Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner-run script looks every catalog edition up on Hardcover by exact ISBN. It adds featured series with positions to `work_series` under the source `hardcover`, fills empty synopses with language-matched descriptions (`summary_source = 'hardcover'`), and fills empty genres from Hardcover's Genre tags.

**Architecture:**
- `postJson` joins the existing HTTP helpers.
- A Hardcover adapter (`adapters/hardcover/hardcover.ts`) owns the query, the parsing, series choice, tag-to-genre mapping and description cleaning.
- A fill (`seed/hardcoverFill.ts`) walks `isbnPage` 50 editions at a time and writes through existing repository methods.
- The script `backend/scripts/fill-hardcover.mjs` wires it to `dist`, the token and the DB, the same way `fill-series.mjs` and `fill-awards.mjs` do.

**Tech Stack:** Fastify/TypeScript backend, `node:sqlite`, `node:test` via `tsx`, `@scripta/shared`, React/Vite web (one label).

**Spec:** `docs/superpowers/specs/2026-10-25-hardcover-enrichment-design.md`

## Global Constraints

**Constants:**
- Endpoint `https://api.hardcover.app/v1/graphql`
- `HARDCOVER_PAGE_SIZE = 50`
- request gap `1100` ms
- `GENRE_MIN_COUNT = 2`, `GENRE_MIN_SHARE = 0.2`, `GENRE_LIMIT = 3`, unless Task 1 records other values
- progress line every `20` requests

**Retries:**
- a 429 with `retryAt` ≤ 120 s is waited out, at most 3 attempts;
- 5xx, 408 and network errors (`SourceUnavailableError` without status 401, 403 or 429) are retried 3 times, 30 s apart.

**Names:**
- source `"hardcover"` in `SeriesSource`, `SummarySource` and the shared `BookMetadata.summarySource`;
- env var `HARDCOVER_API_TOKEN`.

**Series ranks, exactly:** `wikidata: 0, hardcover: 1, "ol-edition": 2, "ol-subject": 3, "original-title": 4`.

**Data rules:**
- Never store per-user Hardcover data. Moods and ratings are not read into any stored field.
- Writes are add-only or fill-empty.

**Repo rules:**
- No comments in code.
- New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list, with the env preamble from `backend/src/modules/books/seed/awardsFill.test.ts:12-18`.
- Rebuild shared (`npm run build --workspace @scripta/shared`) before any consumer's checks.
- Run `node scripts/gate.mjs` before each commit.
- The token is never written to a tracked file. Locally it goes in `backend/.env`, which `backend/.gitignore:3` ignores.

## Review Focus

- **A Portuguese edition never gets an English description.** That means editions whose `language` is null but whose ISBN is Portuguese too (Task 6, test `drops an English description on a Portuguese-ISBN edition with no language`).
- **An existing synopsis is never replaced**, from any source, including when the same ISBN appears twice in one page (Task 6, test `keeps an existing summary and fills a duplicate-ISBN sibling`).
- **A quota stop or error mid-run** must not move the cursor past the failed page, and the report's counters must cover committed pages only (Task 6, test `stops on daily quota with lastRowid of the last committed page`).
- **A work whose two editions match different Hardcover books** gets exactly one `hardcover` series row, from the first edition (Task 6, test `takes series and genres from the first matched edition of a work`).
- **An existing Wikidata series still wins** on the work page after the rank change, and `ol-subject` no longer beats `hardcover` (Task 3).

---

### Task 1: Probe and calibrate against the live API (a controller step, needs the user's token)

This is not an implementer task. It needs `HARDCOVER_API_TOKEN` in `backend/.env`, which the user supplies. It costs about 10 requests out of the token's 5,000 a day. Scratch files go in the session scratchpad, never in the repo.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-25-hardcover-enrichment.md`
- Modify: `docs/superpowers/specs/2026-10-25-hardcover-enrichment-design.md`

- [ ] **Step 1: Check the token.** POST `{ me { id username } }` with `Authorization: Bearer $HARDCOVER_API_TOKEN` and the backend's User-Agent. Expect 200 and one user. Record the `RateLimit-Policy` header.
- [ ] **Step 2: Run the spec's exact `editions` query** with 50 ISBN-13s of well-known books (for example the dev fixture's ISBNs plus popular English titles), and their ISBN-10s. Record:
  - whether `featured_book_series` is selectable, else rewrite the query and Decision 4 to use `book_series { featured ... }`;
  - the real `cached_tags` shape;
  - the response time, which must be well under 30 s;
  - whether `book_status_id` and `canonical_id` come back.
- [ ] **Step 3: Fetch the calibration sample.**
  - First `books(order_by: {id: desc}, limit: 1) { id }`.
  - Then one `books(where: {id: {_in: <600 random ids>}, book_status_id: {_eq: 1}}, limit: 1000) { id title description cached_tags }`.
  - Keep the first 200 that have Genre tags.
- [ ] **Step 4: Label and calibrate.**
  - For each of the 200, Claude writes the right genres from `BOOK_GENRES`, with an empty list allowed.
  - Grid-search `GENRE_MIN_COUNT` ∈ {1,2,3,5}, `GENRE_MIN_SHARE` ∈ {0, 0.1, 0.2, 0.3, 0.5} and `GENRE_LIMIT` ∈ {2,3,4}, scoring with the same rule `genresFromTags` will use (Task 5).
  - Pick the best precision at a recall no lower than 0.5. A wrong genre costs more than a missing one, since the Jev genre pass fills misses later.
- [ ] **Step 5: Read the 200 descriptions.** Note HTML, markdown and boilerplate. Any boilerplate pattern in at least 5 of the 200 becomes a strip rule for Task 5's `descriptionText`, listed here with the exact pattern.
- [ ] **Step 6: Record and commit.**
  - Fill the Calibration results section below: the constants, precision and recall, the boilerplate rules (or "none"), and the shape notes.
  - Update the spec's Decision 8 and Data sections if anything differs.
  - Commit both documents.

#### Calibration results

_Filled by Task 1._

---

### Task 2: `postJson` HTTP helper

**Files:**
- Modify: `backend/src/modules/books/adapters/http/http.ts`
- Test: `backend/src/modules/books/adapters/http/http.test.ts`

**Interfaces:**
- Produces: `export async function postJson(source: string, url: string, body: unknown, headers?: Record<string, string>): Promise<unknown>`.
  - It sends `POST`, `Content-Type: application/json`, the `USER_AGENT` and the `TIMEOUT_MS` abort.
  - A 429 throws the same `SourceUnavailableError` as `failure()`, with `retryAt` and `quota`.
  - Any other non-2xx throws `SourceUnavailableError(source, "HTTP <status> <first 200 chars of body>", { status })`.
  - Invalid JSON throws `SourceUnavailableError(source, "invalid JSON")`.

- [ ] **Step 1: Write the failing tests** in `http.test.ts`, stubbing `globalThis.fetch` as the existing tests there do:
  - `postJson sends method, JSON body and headers`: assert `init.method === "POST"`, `JSON.parse(init.body)` deep-equals the body, `Authorization` is passed through, and `User-Agent === USER_AGENT`.
  - `postJson 429 carries retryAt and quota`: the response has `retry-after: 30` and `ratelimit: "daily";r=0;t=5000`. Assert `error.status === 429`, `error.quota === true`, and `retryAt` ≈ now + 30 000.
  - `postJson 403 includes the body`: body `{"error":"insufficient_scope"}`. Assert `error.status === 403` and that the message contains `insufficient_scope`.
- [ ] **Step 2: Run and see them fail:** `npm exec --workspace backend -- tsx --test src/modules/books/adapters/http/http.test.ts`. Expect `postJson is not a function`.
- [ ] **Step 3: Implement.** Give `request` an optional `init: { method?: string; body?: string }`, which existing callers leave out. `postJson` reuses `request`, `failure` and `readBody`. Only the non-429 branch reads the body into the message.
- [ ] **Step 4: Run the tests and see them pass.** `npm run typecheck --workspace backend` is clean.
- [ ] **Step 5: Commit.** `git add` both files, `git commit -m "Add postJson to the books HTTP helpers"`.

---

### Task 3: `hardcover` series source and rank

**Files:**
- Modify: `backend/src/modules/books/domain/series.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces: `SeriesSource` includes `"hardcover"`, and `SERIES_SOURCE_RANK` is exactly as in Global Constraints. In `bestSeriesOf`, edition collections are confirmed by a `hardcover` row too (`sqliteBooksRepository.ts:1329`).

- [ ] **Step 1: Write the failing tests** next to the existing `bestSeriesOf` tests:
  - `wikidata series beats hardcover`: a work has `addWorkSeries(w, [{name:"Dune Chronicles", position:"1"}], "wikidata", t1)` and `[{name:"Dune", position:"1"}]` under `"hardcover"` at an earlier `t0`. The best series is "Dune Chronicles".
  - `hardcover beats ol-subject`: the best name is the hardcover one.
  - `edition collection gives a hardcover series its position`: a `hardcover` row with a null position, and an edition collection with the same name key and position "3". The best position is "3".
- [ ] **Step 2: Run and see them fail:** `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`.
- [ ] **Step 3: Implement** the type, the ranks and the `|| candidate.source === "hardcover"` condition.
- [ ] **Step 4: Run the tests, plus `seriesFill.test.ts` and `booksService.test.ts`, and see them pass.** `grep -rn SERIES_SOURCE_RANK backend/src` shows no other reader that relies on the old numbers.
- [ ] **Step 5: Commit:** `git commit -m "Rank Hardcover series after Wikidata"`.

---

### Task 4: `hardcover` summary source

**Files:**
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `packages/shared/src/library/bookMetadata.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `frontend/src/lib/bookMetadata.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Test: `frontend/scripts/test-book-metadata.mts`

**Interfaces:**
- Produces: `SummarySource` and `BookMetadata.summarySource` include `"hardcover"`.
- `summaryLink` returns `""` for `"hardcover"`.
- `summarySourceName` returns `"Hardcover"` for it.

- [ ] **Step 1: Write the failing tests:**
  - Backend: `details of a hardcover summary`. Write a summary with `repo.mergeDetails(id, {summary:"A long enough synopsis…", pages:null, year:null, publisher:null, translator:null}, "hardcover")`. Then the service's details for that book have `summarySource === "hardcover"` and `sourceUrl === ""`, even when `books.source_url` is set.
  - Frontend: `summarySourceName({ summarySource: "hardcover", … })` returns `"Hardcover"`.
- [ ] **Step 2: Run and see them fail:** the backend file through `npm exec --workspace backend -- tsx --test src/modules/books/booksService.test.ts`, then `npm test --workspace frontend`.
- [ ] **Step 3: Implement** the unions, the `summaryLink` branch (`if (book.summary_source === "bnp" || book.summary_source === "hardcover") return "";`) and the frontend branch.
- [ ] **Step 4: Rebuild shared, then run typecheck and tests in shared, backend and frontend, plus `npm run lint --workspace frontend`.**
- [ ] **Step 5: Commit:** `git commit -m "Add Hardcover as a summary source"`.

---

### Task 5: Hardcover adapter

**Files:**
- Create: `backend/src/modules/books/adapters/hardcover/hardcover.ts`
- Test: `backend/src/modules/books/adapters/hardcover/hardcover.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: `postJson` (Task 2); `Throttle` and `createThrottle` (`http.ts`); `Sleep` and `realSleep` (`adapters/typesafe/jevRequest.ts`); `normalizeBookGenres`, `htmlToText`, `canonicalIsbn` and `type BookGenre` from `@scripta/shared`; `SourceUnavailableError` (`domain/errors.ts`).
- Produces:
  ```ts
  export const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";
  export const HARDCOVER_PAGE_SIZE = 50;
  export const GENRE_MIN_COUNT, GENRE_MIN_SHARE, GENRE_LIMIT;
  export type HardcoverSeries = { name: string; position: number | null; compilation: boolean };
  export type HardcoverBook = { id: number; usable: boolean; description: string | null; genreTags: Array<{ tag: string; count: number }>; featured: HardcoverSeries | null; series: HardcoverSeries[] };
  export type HardcoverEdition = { isbn13: string | null; book: HardcoverBook };
  export function isbn13To10(isbn13: string): string | null;
  export function editionsQuery(isbn13s: string[]): { query: string; variables: { i13: string[]; i10: string[] } };
  export function parseEditions(data: unknown): HardcoverEdition[];
  export function featuredSeriesOf(book: HardcoverBook): HardcoverSeries | null;
  export function seriesPosition(position: number | null): string | null;
  export function genresFromTags(tags: Array<{ tag: string; count: number }>): BookGenre[];
  export function descriptionText(raw: string | null): string | null;
  export type HardcoverLookup = (isbn13s: string[]) => Promise<HardcoverEdition[]>;
  export function createHardcoverLookup(token: string, deps?: { post?: typeof postJson; throttle?: Throttle; sleep?: Sleep; now?: () => number }): HardcoverLookup;
  ```
- **`parseEditions`:**
  - `usable` is `book_status_id === 1 && canonical_id == null`.
  - `isbn13` is `isbn_13`, else `canonicalIsbn(isbn_10)`, else null.
  - `genreTags` is `cached_tags.Genre`, or the shape Task 1 found, else `[]`.
  - It throws `SourceUnavailableError("hardcover", "GraphQL: <first message>")` when the body has `errors`.
- **`createHardcoverLookup`:**
  - It posts through the throttle (default `createThrottle(1100)`), with `Authorization: Bearer <token>`.
  - It applies the retry rules from Global Constraints.
  - It rethrows a 429 whose `quota` is true, or whose `retryAt` is more than 120 s away, at once.
  - It rethrows 401 and 403 at once.

- [ ] **Step 1: Write the failing tests**, with injected `post` and `sleep` and no network:
  - `isbn13To10`: `9780441172719` → `0441172717`; `9790000000001` → null.
  - `editionsQuery`: `i10` holds only the 978- conversions.
  - `parseEditions`:
    - an `isbn_10`-only edition gets its ISBN-13;
    - `book_status_id: 3` or a set `canonical_id` gives `usable: false`;
    - a missing `Genre` key gives `[]`;
    - a body with `errors` throws.
  - `featuredSeriesOf`: featured wins; a sole unfeatured row is used; two unfeatured rows give null; no rows give null.
  - `seriesPosition`: 1 → "1", 1.5 → "1.5", null → null.
  - `genresFromTags`, with the calibrated constants:
    - a tag below `GENRE_MIN_COUNT` is dropped;
    - a tag below `GENRE_MIN_SHARE` of the top tag is dropped;
    - more than `GENRE_LIMIT` mapped genres are cut to the highest-count ones;
    - an unmappable tag ("Adult") is dropped;
    - the result comes back in `BOOK_GENRES` order.
  - `descriptionText`:
    - `"<p>Hello <i>world</i></p>"` → `"Hello world"`;
    - whitespace-only → null;
    - each boilerplate rule from Task 1 is stripped.
  - `createHardcoverLookup`:
    - a 429 with `retryAt` 30 s away is retried and then succeeds;
    - a 429 with `quota: true` throws without retrying;
    - a 503 is retried 3 times and then throws;
    - a 401 throws on the first call;
    - the sleeps used are 30 000 ms for the 5xx case.
- [ ] **Step 2: Add the file to `backend/package.json`'s `test` list, run it and see it fail:** `npm exec --workspace backend -- tsx --test src/modules/books/adapters/hardcover/hardcover.test.ts`.
- [ ] **Step 3: Implement `hardcover.ts`.**
  - The query text is the spec's (Data → The query), as amended by Task 1.
  - `genresFromTags` sorts by count, descending, and keeps tags with `count >= GENRE_MIN_COUNT && count >= GENRE_MIN_SHARE * top`.
  - It maps each kept tag with `normalizeBookGenres([tag])`, collects distinct genres in that order until it has `GENRE_LIMIT`, and returns `normalizeBookGenres(chosen)`.
- [ ] **Step 4: Run the tests and see them pass.** Typecheck is clean.
- [ ] **Step 5: Commit:** `git commit -m "Add the Hardcover adapter"`.

---

### Task 6: The fill and `isbnPage`

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Create: `backend/src/modules/books/seed/hardcoverFill.ts`
- Test: `backend/src/modules/books/seed/hardcoverFill.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes: everything Task 5 produces; `summaryMatchesLanguage` (`adapters/catalog/languageFilter.ts`); `isPortugueseIsbn` (`domain/normalize.ts`); `seriesNameKey` (`domain/series.ts`); and these existing repository methods: `addWorkSeries`, `mergeDetails`, `fillSourceGenres`, `countEmptyGenreEditions`, `canonicalWorkIds` (use `map.get(id) ?? id`) and `transaction`.
- Produces:
  ```ts
  // ports.ts, BooksRepository:
  isbnPage(afterRowid: number, limit: number): Array<{ rowid: number; id: string; isbn: string; workId: string | null; language: string | null; hasSummary: boolean }>;
  // hardcoverFill.ts:
  export type HardcoverFillOptions = { dryRun: boolean; skipNameKeys: Set<string>; after: number; maxRequests: number | null };
  export type HardcoverReport = { dryRun: boolean; requests: number; editions: number; matched: number; lastRowid: number;
    stoppedBy: "done" | "max-requests" | "daily-quota" | "error"; error?: string;
    series: { added: number; skipped: number; works: number };
    descriptions: { added: number; descriptionWrongLanguage: number; alreadyHadSummary: number };
    genres: { works: number; editions: number; noMappedGenre: number };
    skippedBooks: number; duplicateIsbns: number;
    seriesNames?: Array<{ name: string; works: number }>; genreSamples?: Array<{ tags: string[]; genres: BookGenre[] }> };
  export async function fillFromHardcover(deps: { repo: Pick<BooksRepository, "isbnPage" | "addWorkSeries" | "mergeDetails" | "fillSourceGenres" | "countEmptyGenreEditions" | "canonicalWorkIds" | "transaction">; lookup: HardcoverLookup; now: () => Date; log: (line: string) => void }, options: HardcoverFillOptions): Promise<HardcoverReport>;
  ```
- **`isbnPage`:** `SELECT rowid, id, isbn, work_id, language, (summary IS NOT NULL AND summary <> '') AS has_summary FROM books WHERE rowid > ? AND isbn IS NOT NULL ORDER BY rowid LIMIT ?`.
- **Algorithm per page.** Page counters merge into the report only after the transaction commits.
  1. `lookup(distinct page ISBNs)`.
  2. Build a map from ISBN to our editions in the page.
  3. For each returned edition: an unusable book counts in `skippedBooks`. A second usable Hardcover edition for an ISBN already handled in this page counts in `duplicateIsbns`.
  4. Description: `descriptionText(book.description)`. If our edition already has a summary, count `alreadyHadSummary`. If `!summaryMatchesLanguage(text, edition.language ?? (isPortugueseIsbn(edition.isbn) ? "pt" : null))`, count `descriptionWrongLanguage`. Otherwise `mergeDetails(edition.id, { summary: text, pages: null, year: null, publisher: null, translator: null }, "hardcover")` (skipped in a dry run), and count `added`.
  5. Work-level steps, for the first matched edition of each live work in this run only (a run-wide `seen` set):
     - **Series:** take `featuredSeriesOf`. If its name key is in `skipNameKeys`, count `skipped`. Otherwise `addWorkSeries(workId, [{ name, position: seriesPosition(position) }], "hardcover", now().toISOString())`. In a dry run nothing is written, `added += 1`, and the name is tallied into `seriesNames`.
     - **Genres:** `genresFromTags`. An empty result counts `noMappedGenre`. Otherwise `fillSourceGenres(workId, genres)`, or in a dry run `countEmptyGenreEditions(workId)`. If that is > 0, count `works += 1` and `editions += n`. In a dry run, push `{ tags, genres }` to `genreSamples` until there are 50.
  6. A `SourceUnavailableError` from `lookup` ends the loop:
     - `stoppedBy` is `"daily-quota"` when `quota` is true or `status === 429`, else `"error"`;
     - `error` is the message;
     - `lastRowid` stays at the last committed page.
  7. Progress goes through `log(JSON.stringify({ requests, lastRowid, matched }))` every 20 requests.

- [ ] **Step 1: Write the failing tests** on in-memory SQLite (`applyBooksMigrations` plus `createSqliteBooksRepository`), with a fake `lookup`:
  - `adds the featured series under hardcover`, and `skips a skip-list series name`.
  - `writes a description into an empty summary`: `summary_source === "hardcover"`, `summary_hash` set.
  - `keeps an existing summary and fills a duplicate-ISBN sibling`: two editions share an ISBN, one with a summary. Only the empty one changes, and `alreadyHadSummary === 1`.
  - `drops an English description on a Portuguese-ISBN edition with no language`: ISBN `9789720000000`-style, `language` null. Nothing is written, and `descriptionWrongLanguage === 1`.
  - `fills genres only on empty editions`: one sibling has `["Fantasy"]`, and only the `'[]'` editions change.
  - `takes series and genres from the first matched edition of a work`: two editions of one work match different Hardcover books, giving exactly one `hardcover` series row.
  - `skips deleted or deduped Hardcover books`.
  - `dry run writes nothing and reports the same counts as a real run`: compare the reports, ignoring `dryRun`, `seriesNames` and `genreSamples`.
  - `resumes after a rowid and stops at maxRequests`, with `stoppedBy: "max-requests"` and the right `lastRowid`.
  - `stops on daily quota with lastRowid of the last committed page`: the second lookup throws a quota error. The first page's writes exist, nothing from the second page does, and the counters cover page 1 only.
- [ ] **Step 2: Add the file to the `test` list, run it and see it fail:** `npm exec --workspace backend -- tsx --test src/modules/books/seed/hardcoverFill.test.ts`.
- [ ] **Step 3: Implement** `isbnPage` (port, statement and method) and `fillFromHardcover`. Each page's writes go in one `repo.transaction`.
- [ ] **Step 4: Run the tests, then `npm test --workspace backend` and typecheck, and see them pass.**
- [ ] **Step 5: Commit:** `git commit -m "Fill series, synopses and genres from Hardcover"`.

---

### Task 7: The script, Railway variable and docs

**Files:**
- Create: `backend/scripts/fill-hardcover.mjs`
- Modify: `.railway/railway.ts`
- Modify: `backend/README.md`
- Modify: `docs/services.md`

**Interfaces:**
- Consumes: `createHardcoverLookup` (Task 5) and `fillFromHardcover` (Task 6), from `../dist/...`; `openBooksDb` and `createSqliteBooksRepository`; `waitForBnpLock` (`seed/bnpImport.js`); `seriesNameKey`.
- Produces the CLI `node scripts/fill-hardcover.mjs [--dry-run] [--skip <names.json>] [--after <rowid>] [--max-requests <n>]`.

- [ ] **Step 1: Write the script**, modelled on `fill-series.mjs:1-60` and `fill-awards.mjs`:
  - **Arguments:** `parseArgs` with the four options. A parse error prints the usage and exits 1.
  - **Required environment:** `COVERS_DB_PATH` and `HARDCOVER_API_TOKEN`. A missing one exits 1 with `Missing environment variable: <name>`.
  - **Skip list:** a real run without `--skip` exits 1 with `A real Hardcover fill needs --skip <names.json>: run --dry-run --max-requests 500, review seriesNames, then pass the rejected names (or a file holding []).` The `--skip` file is a JSON array of names, read as `new Set(names.map(seriesNameKey).filter(Boolean))`.
  - **Database:** a dry run opens `new DatabaseSync(COVERS_DB_PATH, { readOnly: true })`, as `fill-series.mjs:124` does. Otherwise it uses `createSqliteBooksRepository(waitForBnpLock(openBooksDb(...)))`, as `fill-awards.mjs:39` does.
  - **Output:** the report goes to stdout as `JSON.stringify(report, null, 2)` and progress to stderr. It exits 1 when `stoppedBy === "error"`, else 0.
- [ ] **Step 2: Add `HARDCOVER_API_TOKEN: preserve(),`** to `.railway/railway.ts`, in alphabetical order after `GOOGLE_CLIENT_SECRET`.
- [ ] **Step 3: Write the docs.**
  - `backend/README.md` gets a "Hardcover enrichment" section next to the series fill. It covers:
    - the terms summary: book facts and credited aggregates only, no per-user data, no LLM training;
    - the token and its Railway variable, set by the user;
    - the runbook steps 2–5 from the spec, verbatim commands with `setsid … &`;
    - resuming with `--after <lastRowid>`, and re-running after large imports;
    - deleting a wrong series row: `DELETE FROM work_series WHERE source = 'hardcover' AND name_key = ?`;
    - why moods and ratings aren't stored.
  - `docs/services.md` gets a production row: Hardcover, used for series, synopses and genres by the owner-run `fill-hardcover.mjs`, in `backend/src/modules/books/adapters/hardcover/`. Plan: Free, 5,000 requests a day, 60 a minute, burst 10, one request per top-level field. Cost risk: none, but the token expires and Hardcover may reset tokens during the API beta, and nothing at runtime depends on it.
- [ ] **Step 4: Verify locally.**
  - Run `npm run build --workspace backend`.
  - From `backend/`, with `COVERS_DB_PATH` set to the dev DB, check that:
    - `node scripts/fill-hardcover.mjs` exits 1 with the skip message;
    - `node scripts/fill-hardcover.mjs --dry-run --max-requests 2` prints a report with `stoppedBy: "max-requests"` or `"done"`, `requests <= 2`, and a matched count for the fixture books. This needs the token in `backend/.env`; without it, check the missing-token message instead.
  - Run `node scripts/gate.mjs` and `npm run check:agents` if any `AGENTS.md` was touched.
- [ ] **Step 5: Commit:** `git commit -m "Add fill-hardcover.mjs, its Railway variable and runbook"`.

---

## Handoff notes

- **Order:** Task 1 needs the token. Tasks 2–4 don't depend on it and can start first. Task 5 needs Task 1's constants, rules and shape notes, and Tasks 6–7 follow Task 5.
- **Production:** steps 1–5 of the spec's runbook go to the user's batched deploy runbook. No production command runs from this plan, and the deploy hold for the pre-2002 BNP import applies.
