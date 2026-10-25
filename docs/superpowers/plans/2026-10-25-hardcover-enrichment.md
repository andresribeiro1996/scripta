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
- a 429 with `retryAt` ≤ 120 s from now is waited out; a 429 with no `retryAt` waits 60 s; at most 3 attempts;
- a 429 whose `retryAt` is more than 120 s away stops at once as a daily-quota stop;
- a `SourceUnavailableError` with `status === undefined`, `status >= 500` or `status === 408` is retried 3 times, 30 s apart;
- every other status, and GraphQL `errors`, throws at once with no retry;
- the Hardcover request timeout is `30_000` ms, passed to `postJson`.

**Names:**
- source `"hardcover"` in `SeriesSource`, `SummarySource` and the shared `BookMetadata.summarySource`;
- env var `HARDCOVER_API_TOKEN`.

**Series ranks, exactly:** `wikidata: 0, hardcover: 1, "ol-edition": 2, "ol-subject": 3, "original-title": 4`.

**Data rules:**
- Never store per-user Hardcover data. Moods and ratings are not read into any stored field.
- Writes are add-only or fill-empty. Only `--remove` deletes, and only `hardcover` series rows with their `series_fts` entries.
- Descriptions are written only where the edition shows no synopsis today, and only when `detectedLanguage(text)` equals the edition's known language (spec Decision 6).

**Repo rules:**
- No comments in code.
- New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list, with the env preamble from `backend/src/modules/books/seed/awardsFill.test.ts:12-19`.
- Rebuild shared (`npm run build --workspace @scripta/shared`) before any consumer's checks.
- Run `node scripts/gate.mjs` before each commit.
- The token is never written to a tracked file. Locally it goes in `backend/.env`, which `backend/.gitignore:3` ignores.

## Review Focus

- **A Portuguese edition never gets an English description.** That means editions whose `language` is null but whose ISBN is Portuguese too (Task 6, test `drops an English description on a Portuguese-ISBN edition with no language`).
- **An existing synopsis is never replaced or hidden**, from any source. That includes an Open Library work summary shown through an empty edition row, and the same ISBN appearing twice in one page (Task 6, tests `keeps an existing summary and fills a duplicate-ISBN sibling` and `leaves an edition whose work shows an Open Library summary`).
- **A quota stop or error mid-run** must not move the cursor past the failed page, and the report's counters must cover committed pages only (Task 6, test `stops on daily quota with lastRowid of the last committed page`).
- **A work whose two editions match different Hardcover books** gets exactly one `hardcover` series row, from the first edition, across resumed runs too (Task 6, tests `takes the series from the first matched edition of a work` and `a resumed run adds no second hardcover series`).
- **An existing Wikidata series still wins** on the work page after the rank change, and `ol-subject` no longer beats `hardcover` (Task 3).

---

### Task 1: Probe and calibrate against the live API (a controller step, needs the user's token)

This is not an implementer task. It needs `HARDCOVER_API_TOKEN` in `backend/.env`, which the user supplies. It costs about 10 requests out of the token's 5,000 a day. Scratch files go in the session scratchpad, never in the repo.

**Files:**
- Modify: `docs/superpowers/plans/2026-10-25-hardcover-enrichment.md`
- Modify: `docs/superpowers/specs/2026-10-25-hardcover-enrichment-design.md`

- [ ] **Step 1: Check the token.** POST `{ me { id username } }` with `Authorization: Bearer $HARDCOVER_API_TOKEN` and the backend's User-Agent. Expect 200 and one user. Record the `RateLimit-Policy` header.
- [ ] **Step 2: Run the spec's exact `editions` query** with 50 ISBN-13s of well-known books (for example the dev fixture's ISBNs plus popular English titles), and their ISBN-10s. Record:
  - what `cached_featured_series` holds: the name, the position, a compilation flag. If it has the name and position, the query uses it alone. Otherwise try `featured_book_series { position compilation series { name } }` and `book_series { … }`, noting any depth rejection, and amend the spec's query and Decision 4;
  - the real `cached_tags` shape;
  - the response time, measured against the 30 s timeout the lookup will use;
  - whether `book_status_id` and `canonical_id` come back.
- [ ] **Step 2b: Probe the error shapes.** Send one request with a deliberately bad token and record the 401/403 status and body. Record the `RateLimit` and `RateLimit-Policy` header format from Step 1's response. Record a 429's headers only if one happens on its own; don't force one.
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

**Partial run, 2026-10-25.** Token works (Free plan: 60/min, burst 10, 5,000/day). About 25 requests were used.

**Shapes:**
- `RateLimit` header: `"Free";r=9;t=0, "daily";r=4935;t=35639`.
- Bad token: `401 {"error":"invalid_token","error_description":"Invalid or expired token"}`.
- `cached_tags` keys are `Tag, Mood, Genre, Group, Content Warning`. Entries look like `{tag, count, tagSlug, category, categorySlug, spoilerRatio}`.
- `cached_featured_series` is `{id, series:{id,name,slug,books_count,primary_books_count}, details, featured, position, collection, unreleased}`, or `{}` when a book has no featured series. **Use it alone.**
- The depth-4 relation query is still accepted today.
- 29 editions came back for 31 dev ISBNs. That response took 533 ms; the next one, the same request minus the series relations, took 316 ms.
- About 3 of the 29 descriptions contained `<i>` tags, and none contained markdown.

**Genre calibration: Hardcover Genre tags are weak.** Two blind-labelled samples were scored:
- 175 random books: best precision 0.56 at recall 0.39, with mostly count-1 imported subjects;
- 197 books with ≥10 readers: best precision 0.52 at recall 0.38 (`c=1, s≥0, l=2`).
- Count thresholds don't help, because most counts are 1. Some counts are corrupted, for example `Young Adult:20448` on an obscure book.

Typical errors:
- "Young Adult" on children's books;
- a default "Fantasy, Adventure, Science Fiction" bundle on unrelated books;
- "Classics" applied loosely.

Scratch data is in the session scratchpad (`hc/calib*.json`, `labels*.txt`).

**Open (user's call):** drop the genre part, or keep it with `GENRE_LIMIT = 1` (precision ~0.55)? The Jev genre pass is probably more accurate. Step 5's boilerplate review was not done.

---

### Task 2: `postJson` HTTP helper

**Files:**
- Modify: `backend/src/modules/books/adapters/http/http.ts`
- Test: `backend/src/modules/books/adapters/http/http.test.ts`

**Interfaces:**
- Produces: `export async function postJson(source: string, url: string, body: unknown, headers?: Record<string, string>, timeoutMs?: number): Promise<unknown>`.
  - It sends `POST`, `Content-Type: application/json`, the `USER_AGENT`, and an abort after `timeoutMs ?? TIMEOUT_MS`.
  - A 429 throws the same `SourceUnavailableError` as `failure()`, with `status: 429` and `retryAt` taken from `Retry-After`. `failure()` and `rateLimitField` are not changed, so ISBNdb's `quota` behaviour stays as it is.
  - Any other non-2xx throws `SourceUnavailableError(source, "HTTP <status> <first 200 chars of body>", { status })`.
  - Invalid JSON throws `SourceUnavailableError(source, "invalid JSON")`.

- [ ] **Step 1: Write the failing tests** in `http.test.ts`, stubbing `globalThis.fetch` as the existing tests there do:
  - `postJson sends method, JSON body and headers`: assert `init.method === "POST"`, `JSON.parse(init.body)` deep-equals the body, `Authorization` is passed through, and `User-Agent === USER_AGENT`.
  - `postJson 429 carries retryAt`: the response has `retry-after: 30`. Assert `error.status === 429` and `retryAt` ≈ now + 30 000.
  - `postJson passes its timeout`: with `timeoutMs` 30 000, the `signal` passed to `fetch` is an `AbortSignal`. Stub `AbortSignal.timeout` and assert it was called with 30 000, and with `TIMEOUT_MS` when the argument is left out.
  - `postJson 403 includes the body`: body `{"error":"insufficient_scope"}`. Assert `error.status === 403` and that the message contains `insufficient_scope`.
- [ ] **Step 2: Run and see them fail:** `npm exec --workspace backend -- tsx --test src/modules/books/adapters/http/http.test.ts`. Expect `postJson is not a function`.
- [ ] **Step 3: Implement.** Give `request` an optional `init: { method?: string; body?: string; timeoutMs?: number }`, which existing callers leave out. `postJson` reuses `request`, `failure` and `readBody`. Only the non-429 branch reads the body into the message.
- [ ] **Step 4: Run the tests and see them pass.** `npm run typecheck --workspace backend` is clean.
- [ ] **Step 5: Commit.** `git add` both files, `git commit -m "Add postJson to the books HTTP helpers"`.

---

### Task 3: `hardcover` series source and rank

**Files:**
- Modify: `backend/src/modules/books/domain/series.ts`
- Test: `backend/src/modules/books/domain/series.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

**Interfaces:**
- Produces:
  - `SeriesSource` includes `"hardcover"`, and `SERIES_SOURCE_RANK` is exactly as in Global Constraints.
  - In `bestSeriesOf`, edition collections are confirmed by a `hardcover` row too (`sqliteBooksRepository.ts:1329`).
  - `BooksRepository.hasWorkSeries(workId: string, source: SeriesSource): boolean`.
  - `BooksRepository.removeWorkSeries(nameKeys: string[], source: SeriesSource): { rows: number; searchRows: number }`.
    - It deletes `work_series` rows with that source and any of those name keys.
    - For each affected `(work_id, name_key)` with no remaining `work_series` row, it deletes that work's `series_fts` rows whose name has the same `seriesNameKey`.
    - It all happens in one transaction.

- [ ] **Step 1: Write the failing tests** next to the existing `bestSeriesOf` tests:
  - `wikidata series beats hardcover`: a work has `addWorkSeries(w, [{name:"Dune Chronicles", position:"1"}], "wikidata", t1)` and `[{name:"Dune", position:"1"}]` under `"hardcover"` at an earlier `t0`. The best series is "Dune Chronicles".
  - `hardcover beats ol-subject`: the best name is the hardcover one.
  - `edition collection gives a hardcover series its position`: a `hardcover` row with a null position, and an edition collection with the same name key and position "3". The best position is "3".
  - `hasWorkSeries is per source`.
  - `removeWorkSeries drops hardcover rows and their search entry`. Afterwards a series search for the name no longer returns the work.
  - `removeWorkSeries keeps the search entry when a wikidata row shares the name key`.
  - In `series.test.ts:19`, update the asserted rank table to the new one.
- [ ] **Step 2: Run and see them fail:** `npm exec --workspace backend -- tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`.
- [ ] **Step 3: Implement** the type, the ranks, the `|| candidate.source === "hardcover"` condition, `hasWorkSeries` and `removeWorkSeries`.
- [ ] **Step 4: Run the tests, plus `series.test.ts`, `seriesFill.test.ts` and `booksService.test.ts`, and see them pass.** `grep -rn SERIES_SOURCE_RANK backend/src` shows no other reader that relies on the old numbers.
- [ ] **Step 5: Commit:** `git commit -m "Rank Hardcover series after Wikidata"`.

---

### Task 4: `hardcover` summary source

**Files:**
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `packages/shared/src/library/bookMetadata.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/booksService.test.ts`

**Interfaces:**
- Produces: `SummarySource` and `BookMetadata.summarySource` include `"hardcover"`.
- `summaryLink` returns `""` for `"hardcover"`. The frontend is unchanged (spec Decision 9).

- [ ] **Step 1: Write the failing tests:**
  - Backend: `details of a hardcover summary`. Write a summary with `repo.mergeDetails(id, {summary:"A long enough synopsis…", pages:null, year:null, publisher:null, translator:null}, "hardcover")`. Then the service's details for that book have `summarySource === "hardcover"` and `sourceUrl === ""`, even when `books.source_url` is set.
- [ ] **Step 2: Run and see them fail:** `npm exec --workspace backend -- tsx --test src/modules/books/booksService.test.ts`.
- [ ] **Step 3: Implement** the unions and the `summaryLink` branch (`if (book.summary_source === "bnp" || book.summary_source === "hardcover") return "";`).
- [ ] **Step 4: Rebuild shared, then run typecheck and tests in shared, backend and frontend.** The frontend consumes the shared union.
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
  // `series` stays [] when Task 1 settles on cached_featured_series alone
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
  - `isbn13` is `isbn_13`, else `canonicalIsbn(isbn_10) || null` (`canonicalIsbn` returns `""` for bad input).
  - `genreTags` is `cached_tags.Genre`, or the shape Task 1 found, else `[]`.
  - It throws `SourceUnavailableError("hardcover", "GraphQL: <first message>")` when the body has `errors`.
- **`createHardcoverLookup`:**
  - It posts through the throttle (default `createThrottle(1100)`), with `Authorization: Bearer <token>` and `timeoutMs` 30 000.
  - It applies the retry rules from Global Constraints, with `parseEditions` outside the retry loop, so a GraphQL error is never retried.
  - A 429 more than 120 s away is rethrown at once, with `quota: true` set on a new `SourceUnavailableError("hardcover", message, { status: 429, retryAt, quota: true })`. The fill reads that as a daily-quota stop.

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
    - a 429 with no `retryAt` waits 60 000 ms and then succeeds;
    - a 429 with `retryAt` an hour away throws at once with `quota === true`;
    - a 503 is retried 3 times, 30 000 ms apart, and then throws;
    - a status-less network error is retried;
    - a 401, a 400 and a GraphQL `errors` body each throw on the first call.
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
- Modify: `backend/src/modules/books/adapters/catalog/languageFilter.ts`
- Create: `backend/src/modules/books/seed/hardcoverFill.ts`
- Test: `backend/src/modules/books/seed/hardcoverFill.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes:
  - everything Task 5 produces;
  - `detectedLanguage`, exported from `adapters/catalog/languageFilter.ts` by this task;
  - `isPortugueseIsbn` (`domain/normalize.ts`) and `seriesNameKey` (`domain/series.ts`);
  - `hasWorkSeries` (Task 3);
  - these existing repository methods: `addWorkSeries`, `mergeDetails`, `fillSourceGenres`, `countEmptyGenreEditions`, `canonicalWorkIds` (use `map.get(id) ?? id`) and `transaction`.
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
  export function editionLanguageOf(edition: { language: string | null; isbn: string }): "pt" | "en" | string | null;
  // book.language's base subtag; else "pt" for isPortugueseIsbn; else "en" for 9780/9781/9798 prefixes; else null
  export async function fillFromHardcover(deps: { repo: Pick<BooksRepository, "isbnPage" | "hasWorkSeries" | "addWorkSeries" | "mergeDetails" | "fillSourceGenres" | "countEmptyGenreEditions" | "canonicalWorkIds" | "transaction">; lookup: HardcoverLookup; now: () => Date; log: (line: string) => void }, options: HardcoverFillOptions): Promise<HardcoverReport>;
  ```
- **`isbnPage`:**
  ```sql
  SELECT b.rowid, b.id, b.isbn, b.work_id, b.language,
         (COALESCE(b.summary, '') <> '' OR (COALESCE(w.summary, '') <> '' AND w.ol_work_key IS NOT NULL)) AS has_summary
  FROM books b LEFT JOIN works w ON w.id = b.work_id
  WHERE b.rowid > ? AND COALESCE(b.isbn, '') <> '' ORDER BY b.rowid LIMIT ?
  ```
- **Algorithm per page.** Page counters merge into the report only after the transaction commits.
  1. `lookup(distinct page ISBNs)`.
  2. Build a map from ISBN to our editions in the page.
  3. For each returned edition: an unusable book counts in `skippedBooks`. A second usable Hardcover edition for an ISBN already handled in this page counts in `duplicateIsbns`.
  4. Description: `descriptionText(book.description)`. If `hasSummary`, count `alreadyHadSummary`. If `detectedLanguage(text)` is null or differs from `editionLanguageOf(edition)`, including when that is null, count `descriptionWrongLanguage`. Otherwise `mergeDetails(edition.id, { summary: text, pages: null, year: null, publisher: null, translator: null }, "hardcover")` (skipped in a dry run), and count `added`.
  5. Work-level steps. Skip them when the edition has no `work_id`.
     - **Series**, for the first matched edition of each live work in this run (a run-wide `seriesSeen` set), and only when `!hasWorkSeries(workId, "hardcover")`:
       - take `featuredSeriesOf`;
       - if its name key is in `skipNameKeys`, count `skipped`;
       - otherwise `addWorkSeries(workId, [{ name, position: seriesPosition(position) }], "hardcover", now().toISOString())`. In a dry run nothing is written and `added += 1`.
       - In both modes, tally each added name into `seriesNames`.
     - **Genres**, for live works not yet in a run-wide `genresDone` set:
       - `genresFromTags`; an empty result counts `noMappedGenre` and doesn't mark the work.
       - Otherwise `fillSourceGenres(workId, genres)`, or in a dry run `countEmptyGenreEditions(workId)`. If that is > 0, count `works += 1` and `editions += n`. Mark the work done.
       - In a dry run, push `{ tags, genres }` to `genreSamples` until there are 50.
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
  - `takes the series from the first matched edition of a work`: two editions of one work match different Hardcover books, giving exactly one `hardcover` series row.
  - `a resumed run adds no second hardcover series`: run 1 stops after page 1; run 2 with `after` reaches a sibling that matches another series; still one row.
  - `genres come from a later sibling when the first maps to nothing`.
  - `leaves an edition whose work shows an Open Library summary`: `books.summary` NULL, and `works.summary` set with `ol_work_key`. Nothing is written, and `alreadyHadSummary === 1`.
  - `writes no English description to a French or a 978-3 null-language edition`.
  - `an edition with no work gets only its description`.
  - `editionLanguageOf`: `pt-PT` → `pt`; null with `9789…` → `pt`; null with `9780…` → `en`; null with `9783…` → null.
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
- Consumes also `removeWorkSeries` (Task 3).
- Produces the CLI `node scripts/fill-hardcover.mjs [--dry-run] [--skip <names.json>] [--after <rowid>] [--max-requests <n>]`, and `node scripts/fill-hardcover.mjs --remove <names.json>`.

- [ ] **Step 1: Write the script**, modelled on `fill-series.mjs:1-60` and `fill-awards.mjs`:
  - **Arguments:** `parseArgs` with the four options. A parse error prints the usage and exits 1.
  - **Required environment:** `COVERS_DB_PATH`, plus `HARDCOVER_API_TOKEN` unless `--remove` is given. A missing one exits 1 with `Missing environment variable: <name>`. The script reads `process.env` only. Locally, run it with `node --env-file=.env`.
  - **`--remove`:** it can't be combined with the other options. It reads a JSON array of names, maps them through `seriesNameKey`, calls `removeWorkSeries(keys, "hardcover")` on the locked read-write repository, and prints `{ removed: { rows, searchRows } }`.
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
    - removing rejected series names with `--remove`, never by hand SQL, since `series_fts` would keep them;
    - updating the series-order sentence at `backend/README.md:176` to "Wikidata over Hardcover over Open Library edition over Open Library subject over original title";
    - why moods and ratings aren't stored.
  - `docs/services.md` gets a production row: Hardcover, used for series, synopses and genres by the owner-run `fill-hardcover.mjs`, in `backend/src/modules/books/adapters/hardcover/`. Plan: Free, 5,000 requests a day, 60 a minute, burst 10, one request per top-level field. Cost risk: none, but the token expires and Hardcover may reset tokens during the API beta, and nothing at runtime depends on it.
- [ ] **Step 4: Verify locally.**
  - Run `npm run build --workspace backend`.
  - From `backend/`, with `COVERS_DB_PATH=data/dev/covers.sqlite` (the dev stack's DB, not `data/covers.sqlite`), check that:
    - `node --env-file=.env scripts/fill-hardcover.mjs` exits 1 with the skip message;
    - `node --env-file=.env scripts/fill-hardcover.mjs --dry-run --max-requests 2` prints a report with `stoppedBy: "max-requests"` or `"done"`, `requests <= 2`, and a matched count for the fixture books. This needs the token in `backend/.env`; without it, check the missing-token message instead.
    - `--remove` with `[]` prints `{ removed: { rows: 0, searchRows: 0 } }`.
  - Run `node scripts/gate.mjs` and `npm run check:agents` if any `AGENTS.md` was touched.
- [ ] **Step 5: Commit:** `git commit -m "Add fill-hardcover.mjs, its Railway variable and runbook"`.

---

## Handoff notes

- **Order:** Task 1 needs the token. Tasks 2–4 don't depend on it and can start first. Task 5 needs Task 1's constants, rules and shape notes, and Tasks 6–7 follow Task 5.
- **Production:** steps 1–5 of the spec's runbook go to the user's batched deploy runbook. Before the `railway config apply` that adds the `preserve()` entry, read its plan. Check `railway volume list --json` before the real run. No production command runs from this plan, and the deploy hold for the pre-2002 BNP import applies.
