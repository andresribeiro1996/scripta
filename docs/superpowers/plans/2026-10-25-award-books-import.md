# Award Books Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-off script adds the book-prize winners and nominees on Wikidata that match no catalog book, through the same save path user search uses, with Open Library as the only source.

**Architecture:**
- The core of the books service's `saveHits` moves into `books/saveHits.ts` as `saveCatalogHits`, which the service and the script both call.
- `seed/awardBooksImport.ts` turns the awards fill's Wikidata bindings into per-work candidates, finds the ones the catalog lacks, resolves each through Open Library search, and saves the hits.
- `scripts/import-award-books.mjs` wires it up like `fill-awards.mjs`.

**Tech Stack:** Fastify/TypeScript + `node:sqlite`, `@scripta/shared`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-25-award-books-import-design.md`

## Global Constraints

- Book prizes only: keys whose `PRIZES[key].honours === "work"` (`booker`, `international-booker`, `hugo-novel`, `nebula-novel`, `pulitzer-fiction`, `leya`, `saramago`, `ape-novel`). Never `nobel-literature` or `camoes`.
- Only statements with a year (`?year` bound) count. An undated work would never get a pill.
- Open Library only, through `createOpenLibraryCatalog(throttle, false).search`, with a `createThrottle(1000)` throttle. No ISBNdb and no BNP.
- Every Wikidata query, then every Open Library lookup, then the writes. A dry run makes the same lookups and calls no repository method that writes.
- An Open Library 429 (`SourceUnavailableError` with `status === 429`) ends the run. Any other `SourceUnavailableError` puts the work's Wikidata item ID in `failedKeys` and the run goes on. Every other error propagates.
- Writes go in chunks of 25 hits through `saveCatalogHits`, with a 250 ms pause between chunks and no outer transaction. Keep the write lock short, because the server writes to the same DB. Don't wrap chunks in a transaction.
- The edition rule:
  - A hit found by Open Library work ID is saved **without an ISBN** (`result.isbn = null`). It goes in by title, author, work key and cover id, because Open Library's first ISBN for a work is an arbitrary edition, often a translation.
  - A hit found by ISBN is saved under the ISBN that was searched.
  - ISBNs on the work item itself are tried before its edition items' ISBNs.
- Queries: only the `on-work/*`, `on-author/*` and `on-prize/*` kinds of `awardQueries()`. The `author-prize/*` queries are skipped.
- No code comments. New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list. Run `node scripts/gate.mjs` before every commit.

## Review Focus

- **A book found, not created:** `findExisting` adopts an existing book with the same ISBN key, or with the same title and author when that book has no ISBN. A work-ID hit has no ISBN, so a catalog book with its title and author is found through the title key. It is not duplicated, and it doesn't count as `created` (Task 2). An ISBN hit whose title and author exist under another ISBN becomes a second edition. That is intended, and `findExisting` doesn't change.
- **Two Wikidata works, one Open Library work:** both resolve to one book, created once and counted once (Task 2).
- **One work under two prizes:** a Hugo and Nebula nominee is one candidate and one book, counted under both prizes (Task 2).
- **A hit with no ISBN:** an Open Library doc without ISBNs still saves, by title and author, with its work key (Task 1).
- **`--max` below the resolved count:** only the first `max` resolved works are saved, and the report shows `resolved` above `created` (Task 2).

---

### Task 1: Share the search save path

**Files:**
- Create: `backend/src/modules/books/saveHits.ts`
- Test: `backend/src/modules/books/saveHits.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces:
  - `saveCatalogHits(deps: { repo: BooksRepository; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean }, hits: CatalogSearchHit[], at: string): Array<BookRow | null>`. It returns one entry per hit, aligned by index, with `null` where `lookupIdentity` gives nothing, else the book's fresh row.
  - `storeSeries(repo: BooksRepository, bookId: string, found: { editionSeries?: SeriesEntry[]; subjectSeries?: SeriesEntry[] }, at: string): void`, moved out of the service closure.
  - `SAVE_GROUP_LIMIT = 50` moves with them.

- [ ] **Step 1: Write the failing tests** in `saveHits.test.ts`, with a fresh SQLite repository as `sqliteBooksRepository.test.ts` builds one:
  - "saveCatalogHits creates a book with the hit's work key and makes it searchable". Afterwards `repo.findBookByKey("isbn:…")` has `ol_work_key` set and `repo.searchBooks(tokens, 10)` finds it.
  - "saveCatalogHits finds an existing book by ISBN instead of creating one". The same id comes back and the `books` count is unchanged.
  - "a hit with no title or no author saves nothing". Its entry is `null`.
  - "a hit with no ISBN saves by title and author with its work key".
  - "saved books that share a title key end up in one work".
- [ ] **Step 2:** `npx tsx --test src/modules/books/saveHits.test.ts` (from `backend/`) fails on the missing module.
- [ ] **Step 3: Implement.**
  - Move these into `saveHits.ts`:
    - `saveHits`' per-hit body from `lookupIdentity` through `storeSeries` (`booksService.ts:230-241`);
    - the title-key merge and grouping (`:244-249`);
    - `storeSeries` (`:273`).
  - Line 242's `coverUrl` mapping stays in the service.
  - `saveHits` in the service calls `saveCatalogHits({ repo: deps.repo, sharesArena: deps.sharesArena }, hits, now().toISOString())`. It keeps the cover scheduling, `coverUrl`, `workId`, `withSeries` and `coveredFirst` mapping it does today.
  - The service's other `storeSeries` calls use the moved function.
  - Add the test file to `backend/package.json`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass, with every existing books service test unchanged.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 2: Candidates, lookups and the import

**Files:**
- Create: `backend/src/modules/books/seed/awardBooksImport.ts`
- Test: `backend/src/modules/books/seed/awardBooksImport.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Consumes:
  - `saveCatalogHits` (Task 1);
  - `Binding` and `listOf` (`adapters/wikidata/sparql.ts`);
  - `itemOf`, plus a new export `prizeOf(binding: Binding): PrizeKey | null` (`seed/awardsFill.ts`). `prizeOf` is the existing private `PRIZE_OF_ITEM` lookup at line 98, exported so the item map isn't copied, and `awardRowsOf` uses it;
  - `PRIZES`, `PrizeKey` and `canonicalIsbn` (`@scripta/shared`);
  - `normalizeWorkKey` (`domain/normalize.ts`);
  - `SourceUnavailableError`.
- Produces:
  - `type AwardWork = { item: string; prizes: PrizeKey[]; isbns: string[]; olWorkIds: string[] }`.
    - `item` is the Wikidata ID (`Q…`), and `prizes` follow `PRIZES` order.
    - `isbns` are canonical and deduplicated. ISBNs from a `*/isbn` page (on the work item) come before ISBNs from a `*/edition-isbn` page.
  - `awardWorksOf(pages: Array<{ kind: string; bindings: Binding[] }>): AwardWork[]`.
    - It groups by `itemOf(binding.work.value)`.
    - It keeps only book prizes (via `prizeOf`) and bindings with a `year`.
    - It unions identifiers across bindings and kinds.
  - `missingAwardWorks(repo: Pick<BooksRepository, "findBookByKey" | "workIdsByWorkKeys">, works: AwardWork[]): AwardWork[]`. These are the works with no `isbn:<isbn>` key and no Open Library ID in the catalog.
  - `resolveAwardWork(search: BookCatalog["search"], work: AwardWork): Promise<CatalogSearchHit | null>`.
    - Open Library IDs come first: `search({ text: "key:/works/<id>" })`. It takes the first hit whose `normalizeWorkKey(hit.workKey)` equals that ID, with `result.isbn` set to `null`.
    - Then each ISBN in `work.isbns` order: `search({ isbn })`. It takes the first hit, with `result.isbn` replaced by the searched ISBN.
    - A hit with an empty title or no authors is skipped.
  - `importAwardBooks(deps: { repo: BooksRepository; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean; search: BookCatalog["search"]; log: (line: string) => void; sleep?: (ms: number) => Promise<void> }, works: AwardWork[], at: string, options: { dryRun: boolean; max: number | null }): Promise<AwardBooksReport>`.
    - `works` are the missing works.
    - It logs `{ resolved, unresolved, failed }` every 100 works.
    - A created book is a saved row whose `created_at === at`. Created books are tracked as a set of book ids, so a book saved twice counts once.
    - A prize's `created` is the number of distinct created book ids among works listed for that prize.
  - `type AwardBooksReport = { at: string; prizes: Partial<Record<PrizeKey, { candidates: number; resolved: number; created: number; unresolved: number }>>; requests: number; failedKeys: string[]; unresolved: string[]; createdBookIds: string[] }`.
    - `prizes` has one entry per book prize.
    - `unresolved` holds at most 50 `item` IDs.
    - `requests` counts `search` calls.
    - `createdBookIds` lists every book this run created, so a bad run can be found and undone.

- [ ] **Step 1: Write the failing tests** in `awardBooksImport.test.ts`. Use bindings shaped like the awards fill's pages, a stub `search`, a no-op `sleep`, and a fresh SQLite repository for the save tests.
  - "awardWorksOf groups a work's bindings across identifier kinds and prizes"
  - "awardWorksOf drops author prizes, unlisted items and undated statements"
  - "missingAwardWorks keeps only works the catalog has by neither ISBN nor Open Library ID"
  - "resolveAwardWork takes the Open Library hit whose work key matches and rejects another work"
  - "resolveAwardWork falls back to the ISBNs and saves the searched ISBN"
  - "resolveAwardWork skips a hit with no title or no author, and returns null when nothing fits"
  - "awardWorksOf puts a work's own ISBNs before its editions' ISBNs"
  - "resolveAwardWork saves a work-ID hit without an ISBN"
  - "importAwardBooks creates the resolved books, counts each under every prize it is listed for, and lists the unresolved"
  - "two works resolving to one Open Library work create one book"
  - "a work-ID hit whose title and author the catalog already has is found, not created"
  - "a dry run makes the same searches and writes nothing". The repository's write methods throw if called.
  - "max stops saving after that many works"
  - "an Open Library 429 ends the run before any write; another source failure goes to failedKeys"
- [ ] **Step 2:** `npx tsx --test src/modules/books/seed/awardBooksImport.test.ts` fails on the missing module.
- [ ] **Step 3:** Implement. Add the test file to `backend/package.json`.
- [ ] **Step 4:** `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. All pass.
- [ ] **Step 5:** `node scripts/gate.mjs`, then commit.

### Task 3: The script and its README section

**Files:**
- Create: `backend/scripts/import-award-books.mjs`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes:
  - `awardQueries` (`seed/awardsFill.ts`);
  - `queryAllPages` and `queryWikidata` (`adapters/wikidata/sparql.ts`);
  - `awardWorksOf`, `missingAwardWorks` and `importAwardBooks` (Task 2);
  - `createOpenLibraryCatalog`;
  - `createThrottle`;
  - `openBooksDb`, `createSqliteBooksRepository` and `waitForBnpLock`;
  - `createSqliteArenaRepository` and `arenaCheck`, built as `scripts/merge-duplicate-works.mjs:27,46` builds them.

- [ ] **Step 1: Write the script**, modelled on `fill-awards.mjs`.
  - `parseArgs` takes `--dry-run` and `--max <n>`. A positive integer is required for `--max`, and an unknown option prints the usage and exits 1.
  - `COVERS_DB_PATH` and `ARENA_DB_PATH` are required. Arguments and env are checked before any dynamic import from `dist`, as `fill-awards.mjs` does, because `connection.js` loads the env config on import. The arena DB is always opened read-only.
  - The dry run opens the books DB read-only. A real run uses `openBooksDb()`, and both go through `waitForBnpLock`.
  - It runs the non-`author-prize` `awardQueries()` pages through `queryAllPages` with `queryWikidata`, logging to stderr. It passes `{ kind, bindings }` per query to `awardWorksOf`, then calls `missingAwardWorks`, then `importAwardBooks`.
  - It prints `{ dryRun, max, works, missing, ...report }` as JSON on stdout, where `works` and `missing` are counts.
- [ ] **Step 2: Add the README section.** `backend/README.md` gets "Importing missing prize books" under "Book awards". It covers:
  - what the script does and its report;
  - dry run first, then `--max 20` and a look at those books, then the full run, then `fill-awards.mjs` (not dry) so the new books get their pills;
  - deploys held while it runs;
  - the `railway ssh` commands, in the same `setsid` form as the awards fill, with output in `/data/import-award-books*.json`;
  - how to list a run's books: `SELECT id, title, author, isbn FROM books WHERE created_at = '<at>'`, with `at` taken from the report. A wrong book is removed by hand, one at a time, after checking that no reader holds it.
- [ ] **Step 3: Verify.**
  - `npm run build --workspace backend`.
  - `node backend/scripts/import-award-books.mjs --bogus` exits 1 with the usage, and `--max 0` exits 1.
  - A `node --input-type=module -e` check, run from `backend/`, that every name the script imports from `dist` is a function.
  - A live dry run against the local dev catalog, run from `backend/` and in the background: `COVERS_DB_PATH=data/dev/covers.sqlite ARENA_DB_PATH=data/dev/arena.sqlite node scripts/import-award-books.mjs --dry-run`. Almost every prize work is missing from the 24-book dev catalog, so expect about 15 minutes at one request a second. It must run to the end and print a report with non-zero `candidates`. Record its numbers and timing in the report.
- [ ] **Step 4:** `node scripts/gate.mjs`, then commit.

## After merge

With the user's go-ahead, and production deploys held:
0. Deploy main, since the script only exists on Railway once `production` is moved. Check that no other session's `railway ssh` job is running first.
1. Run a dry run on Railway and review `prizes`, `unresolved` and `failedKeys` with the user.
2. Run with `--max 20`, then check a few of those books' pages.
3. Run the full import.
4. Run `fill-awards.mjs` for real, so the new books get their award rows.
