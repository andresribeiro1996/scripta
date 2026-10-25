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
- Writes go in chunks of 25 hits through `saveCatalogHits`, with a 250 ms pause between chunks and no outer transaction.
- No code comments. New backend `*.test.ts` files go into `backend/package.json`'s explicit `test` list. Run `node scripts/gate.mjs` before every commit.

## Review Focus

- **A book found, not created:** a resolved hit whose ISBN or title and author already exist in the catalog is found by `findExisting` and not duplicated, and it doesn't count as `created` (Task 2).
- **Two Wikidata works, one Open Library work:** both resolve to one book, created once (Task 2).
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
  - "saveCatalogHits creates a book with the hit's work key and makes it searchable". Afterwards `repo.findBookByKey("isbn:…")` has `ol_work_key` set and `repo.searchBooks(tokens)` finds it.
  - "saveCatalogHits finds an existing book by ISBN instead of creating one". The same id comes back and the `books` count is unchanged.
  - "a hit with no title or no author saves nothing". Its entry is `null`.
  - "a hit with no ISBN saves by title and author with its work key".
  - "saved books that share a title key end up in one work".
- [ ] **Step 2:** `npx tsx --test src/modules/books/saveHits.test.ts` (from `backend/`) fails on the missing module.
- [ ] **Step 3: Implement.**
  - Move `saveHits`' per-hit body (`booksService.ts:229-243`), the title-key merge and grouping (`:244-249`) and `storeSeries` (`:273`) into `saveHits.ts`.
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
- Consumes: `saveCatalogHits` (Task 1); `Binding` and `listOf` (`adapters/wikidata/sparql.ts`); `PRIZE_ITEMS` (`domain/awards.ts`); `PRIZES`, `isPrizeKey`, `PrizeKey` and `canonicalIsbn` (`@scripta/shared`); `normalizeWorkKey` (`domain/normalize.ts`); `SourceUnavailableError`.
- Produces:
  - `type AwardWork = { item: string; prizes: PrizeKey[]; isbns: string[]; olWorkIds: string[] }`. `item` is the Wikidata ID (`Q…`), `prizes` follow `PRIZES` order, and ISBNs are canonical.
  - `awardWorksOf(bindings: Binding[]): AwardWork[]`. It groups by the binding's `work` value, keeps only book prizes and bindings with a `year`, and unions identifiers across bindings and kinds.
  - `missingAwardWorks(repo: Pick<BooksRepository, "findBookByKey" | "workIdsByWorkKeys">, works: AwardWork[]): AwardWork[]`. These are the works with no `isbn:<isbn>` key and no Open Library ID in the catalog.
  - `resolveAwardWork(search: BookCatalog["search"], work: AwardWork): Promise<CatalogSearchHit | null>`.
    - Open Library IDs come first: `search({ text: "key:/works/<id>" })`, taking the first hit whose `normalizeWorkKey(hit.workKey)` equals that ID.
    - Then each ISBN: `search({ isbn })`, taking the first hit, with `result.isbn` replaced by the searched ISBN.
    - A hit with an empty title or no authors is skipped.
  - `importAwardBooks(deps: { repo: BooksRepository; sharesArena: (fromWorkId: string, intoWorkId: string) => boolean; search: BookCatalog["search"]; log: (line: string) => void; sleep?: (ms: number) => Promise<void> }, works: AwardWork[], at: string, options: { dryRun: boolean; max: number | null }): Promise<AwardBooksReport>`.
    - `works` are the missing works.
    - It logs `{ resolved, unresolved, failed }` every 100 works.
    - `created` counts saved rows whose `created_at === at`.
  - `type AwardBooksReport = { prizes: Record<PrizeKey, { candidates: number; resolved: number; created: number; unresolved: number }>; requests: number; failedKeys: string[]; unresolved: string[] }`.
    - `prizes` lists only book prizes.
    - `unresolved` holds at most 50 `item` IDs.
    - `requests` counts `search` calls.

- [ ] **Step 1: Write the failing tests** in `awardBooksImport.test.ts`. Use bindings shaped like the awards fill's pages, a stub `search`, a no-op `sleep`, and a fresh SQLite repository for the save tests.
  - "awardWorksOf groups a work's bindings across identifier kinds and prizes"
  - "awardWorksOf drops author prizes, unlisted items and undated statements"
  - "missingAwardWorks keeps only works the catalog has by neither ISBN nor Open Library ID"
  - "resolveAwardWork takes the Open Library hit whose work key matches and rejects another work"
  - "resolveAwardWork falls back to the ISBNs and saves the searched ISBN"
  - "resolveAwardWork skips a hit with no title or no author, and returns null when nothing fits"
  - "importAwardBooks creates the resolved books, counts each under every prize it is listed for, and lists the unresolved"
  - "two works resolving to one Open Library work create one book"
  - "an existing book is found, not created"
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
  - `COVERS_DB_PATH` and `ARENA_DB_PATH` are required. The arena DB is always opened read-only.
  - The dry run opens the books DB read-only. A real run uses `openBooksDb()`, and both go through `waitForBnpLock`.
  - It runs every `awardQueries()` page through `queryAllPages` with `queryWikidata`, logging to stderr, then `awardWorksOf`, then `missingAwardWorks`, then `importAwardBooks`.
  - It prints `{ dryRun, max, works, missing, ...report }` as JSON on stdout.
- [ ] **Step 2: Add the README section.** `backend/README.md` gets "Importing missing prize books" under "Book awards". It covers:
  - what the script does and its report;
  - dry run first, then `--max 20` and a look at those books, then the full run, then `fill-awards.mjs` (not dry) so the new books get their pills;
  - deploys held while it runs;
  - the `railway ssh` commands, in the same `setsid` form as the awards fill, with output in `/data/import-award-books*.json`.
- [ ] **Step 3: Verify.**
  - `npm run build --workspace backend`.
  - `node backend/scripts/import-award-books.mjs --bogus` exits 1 with the usage, and `--max 0` exits 1.
  - A `node --input-type=module -e` check that every name the script imports from `dist` is a function.
  - A live dry run against the local dev catalog (`COVERS_DB_PATH=backend/data/dev/covers.sqlite ARENA_DB_PATH=backend/data/dev/arena.sqlite`). It runs to the end and prints a report with non-zero `candidates`. Record its numbers and timing in the report.
- [ ] **Step 4:** `node scripts/gate.mjs`, then commit.

## After merge

With the user's go-ahead, and production deploys held:
1. Run a dry run on Railway and review `prizes`, `unresolved` and `failedKeys` with the user.
2. Run with `--max 20`, then check a few of those books' pages.
3. Run the full import.
4. Run `fill-awards.mjs` for real, so the new books get their award rows.
