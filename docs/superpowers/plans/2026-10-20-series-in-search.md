# Series in Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog search matches story series and publisher collections, results and book pages show them, and free sources fill them.

**Architecture:**
- **Storage:**
  - Story series live on works (`work_series`) and are read through canonical work ids plus aliases, so merges and undos need no carrying.
  - Publisher collections live on editions (`book_collections`).
- **Search:** two small FTS5 indexes, `series_fts(name, author)` and `collections_fts(name)`, are queried next to `books_fts`. Results stay grouped: title/author hits, then series, then collections.
- **Display:** one shared `BookSeries` type plus a label formatter feed five surfaces.
- **Sources:** each source writes through one repository method. Capture runs from now on; one-off scripts fill existing rows.

**Tech Stack:** Fastify/TypeScript backend on SQLite (`node:sqlite`, FTS5), `@scripta/shared` (from `dist`), an Expo Router mobile app, a React/Vite web app, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-20-series-in-search-design.md`

## Global Constraints

- **Copy, verbatim:**
  - A story series reads "Name · 3", or "Name" when there's no position.
  - A collection reads "Name collection · 248", or "Name collection" when there's no number. A name already containing "collection", "coleção" or "colecção" (case- and accent-insensitive) is not given " collection".
  - There is never more than one series line per result or page.
- **API changes are additive only:** new optional fields, so older installed apps ignore them. No route, field or parameter is removed or changes meaning.
- **Readers' own library series never reach the catalog tables or search.** Nothing in this plan reads `library_books` or `library.json` series names.
- **`books_fts` is not rebuilt or altered.** The pinned test `sqliteBooksRepository.test.ts:237-250` (exactly one statement with `books_fts MATCH`) must still pass unchanged.
- **Series-matched editions still need `books_search` membership,** the same visibility rule as today (`booksService.test.ts:935`).
- **Community Discover (`works.ts` `matchWorksWith`) is unchanged.** Series matching lives only in `booksService.search`.
- **Source priority for the work's shown series:** `wikidata` > `ol-edition` > `ol-subject` > `original-title`.
- **Wikidata joins only by ISBN or Open Library work ID** (`OL…W` only; P648 also holds `OL…M` and `OL…A`), never by title and author.
- **An Open Library edition `series` value is an edition collection** (source `ol-edition`). It becomes a work story series only when Wikidata or an `ol-subject` row on the same work has the same `seriesNameKey`.
- **Series-like original titles are written only from a reviewed list.**
- **Repo rules:** no comments in code; rebuild `@scripta/shared` before backend or mobile tests; list new backend test files in `backend/package.json`; commits end with a `Co-Authored-By` trailer.

## Review Focus

1. **A query matching hundreds of collection members** ("clássicos"): results stay capped at 12 editions or 20 works, title hits are never pushed out, and the query stays fast. The collection search has a `LIMIT`, and Task 2's tests use a 200-member collection.
2. **A series attached to a work that was later merged or undone:** it still shows on the live work. Task 1 tests this through `mergeTranslation` plus `undoMerge`.
3. **A series match whose only editions aren't in `books_search`:** nothing is returned (Task 2 test).
4. **Odd source strings:**
   - "Malazan Book of the Fallen (3)", "Name #3", "Name, Book Three" and "Name ; 3" parse to name and position, or to the name alone when no number;
   - an empty or punctuation-only name is dropped (Task 4 parser tests);
   - 225 `$v` with values like "248" or "n.º 12" keeps the text as the position.
5. **Tapping a series on the mobile book page while the Search tab is already open with another query:** the new query replaces it and runs (Task 3 test or device pass).

### Task 1: Series and collection storage

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Create: `backend/src/modules/books/domain/series.ts`
- Test: `backend/src/modules/books/domain/series.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- **Produces, in `domain/series.ts`:**
  - `export type SeriesSource = "wikidata" | "ol-edition" | "ol-subject" | "original-title";`
  - `export type CollectionSource = "bnp" | "ol-edition";`
  - `export type SeriesEntry = { name: string; position: string | null };`
  - `export const SERIES_SOURCE_RANK: Record<SeriesSource, number>` (wikidata 0, ol-edition 1, ol-subject 2, original-title 3).
  - `export function seriesNameKey(name: string): string | null`, which returns `normalizeWords(name)` trimmed, or null when empty. It is used for uniqueness.
- **Tables, in `books.sql` and created `IF NOT EXISTS`, with no `user_version` step:**
  - `work_series(work_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, position TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (work_id, name_key, source))`
  - `book_collections(book_id TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, position TEXT, source TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (book_id, name_key, source))`
  - `series_fts USING fts5(work_id UNINDEXED, name, author, tokenize='unicode61 remove_diacritics 2')`
  - `collections_fts USING fts5(book_id UNINDEXED, name, tokenize='unicode61 remove_diacritics 2')`
- **Produces, as repository methods with their ports:**
  - `addWorkSeries(workId: string, entries: SeriesEntry[], source: SeriesSource, at: string): number`
    - An upsert per `(work_id, name_key, source)`. It fills a null position, never overwrites a set one, and inserts the FTS row once per `(work_id, name_key)` with the work's current author.
    - It returns rows added.
  - `addBookCollection(bookId: string, entry: SeriesEntry, source: CollectionSource, at: string): boolean`, with the same rules per book.
  - `bestSeriesOf` also returns an `ol-edition` collection name as the work's story series when a `wikidata` or `ol-subject` row on the work has the same `seriesNameKey`. The position comes from the `ol-edition` row when the others have none.
  - `bestSeriesOf(workIds: string[]): Map<string, SeriesEntry>`
    - Input ids are canonical work ids.
    - It reads rows for each id plus its aliases (`aliasesOf`), and picks the lowest `SERIES_SOURCE_RANK`, then the earliest `created_at`.
    - The position comes from the best-ranked row that has one, for the same name key.
  - `collectionsOf(bookIds: string[]): Map<string, SeriesEntry>`, picking the earliest per book.
  - `searchSeriesWorks(tokens: string[], limit: number): string[]` returns canonical work ids from `series_fts MATCH matchExpression(tokens)`, ordered by bm25. It reads up to `WORK_SCAN_LIMIT` index rows, maps them through `canonicalWorkIds`, dedupes, then slices to `limit`, so merged works don't use up the limit.
  - `searchCollectionBooks(tokens: string[], limit: number): string[]` returns book ids by bm25 with `LIMIT`.

- [ ] **Step 1: Write the failing tests**, in `sqliteBooksRepository.test.ts` and `domain/series.test.ts`:
  - `addWorkSeries` stores "Malazan Book of the Fallen" with position "3", and a second call from another source adds a row.
  - `bestSeriesOf` returns the Wikidata row over the `ol-subject` row.
  - A series added to work A, after `mergeTranslation(A, B)`, shows in `bestSeriesOf([B])`. After `undoMerge(A)` it shows in `bestSeriesOf([A])` again.
  - `searchSeriesWorks(["malazan"], 10)` and `searchSeriesWorks(["malazan", "erikson"], 10)` both return the work, the second matching on the author column.
  - `searchSeriesWorks` of a work merged away returns the canonical id once.
  - `addBookCollection` for "Bang!" with "248" is returned by `collectionsOf`, and `searchCollectionBooks(["bang"], 5)` finds the book.
  - `seriesNameKey("  Bang! ")` equals `seriesNameKey("bang")`, and `seriesNameKey("--")` is null.
- [ ] **Step 2: Run the tests and see them fail.** Run `cd backend && npx tsx --test src/modules/books/domain/series.test.ts src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`, with the env preamble the repo tests already use.
- [ ] **Step 3: Implement** the tables and methods above. Reuse `matchExpression` and `canonicalWorkIds`/`aliasesOf`. Add `series.test.ts` to `backend/package.json`.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`. Expected: all pass, and the `books_fts MATCH` statement-count test is unchanged.
- [ ] **Step 5: Commit**: `Store story series per work and collections per edition`.

### Task 2: Search and result fields

**Files:**
- Modify: `packages/shared/src/library/bookSearch.ts`
- Test: `packages/shared/src/library/bookSearch.test.ts`
- Modify: `packages/shared/src/works/types.ts`
- Modify: `packages/shared/src/works/bookScreen.ts`
- Test: `packages/shared/src/works/bookScreen.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `backend/src/modules/works/service.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- **Consumes** Task 1's repository methods and `SeriesEntry`.
- **Produces, in `@scripta/shared` (`library/bookSearch.ts`):**
  - `export type BookSeries = { name: string; kind: "series" | "collection"; position: string | null };`
  - `export function seriesLabel(series: BookSeries): string`, exact copy from Global Constraints.
  - `BookSearchResult` gains `series?: BookSeries`.
- **Produces, in `@scripta/shared` (`works/types.ts`):**
  - `WorkPage["work"]` gains `series?: BookSeries | null`, the work's best story series.
  - `WorkEdition` gains `collection?: BookSeries | null`.
- **Produces, in `works/bookScreen.ts`:** `BookScreenModel` gains `series: BookSeries | null`, which is `work.series ?? (selected ?? editions[defaultEditionIndex]).collection ?? null`. `selected` is undefined on the default edition (`bookScreen.ts:91`).
- **Backend `booksService.search(query, { byWork })`:**
  1. Run title/author search exactly as today.
  2. Then series: `searchSeriesWorks(tokens, WORK_SEARCH_LIMIT)`. For each work not already present, pick one representative edition: its earliest-created searchable edition, via `editionsOf` (`sqliteBooksRepository.ts:177`, earliest first), `isSearchable` and `getBook`. Append in that order.
  3. Then collections: `searchCollectionBooks(tokens, SEARCH_LIMIT)`, searchable books not already present, appended. With `byWork`, dedupe collection hits by canonical work too.
  4. Cap at today's limits (12 editions, 20 works with `byWork`).
  5. Every result gets `series`. A result found by a collection match carries that collection (`kind: "collection"`). Every other result carries the work's best series (`kind: "series"`), else the edition's collection, else nothing.
  6. `searchExternal` results get `series` the same way, once saved, through `saveHits`' book rows.
- **Backend work page:** `getWorkPageWith`/`works/service.ts` sets `work.series` from `bestSeriesOf([canonical])` and each edition's `collection` from `collectionsOf(editionIds)`.

- [ ] **Step 1: Write the failing tests:**
  - **shared:**
    - `seriesLabel({ name: "Malazan Book of the Fallen", kind: "series", position: "1" }) === "Malazan Book of the Fallen · 1"`
    - `seriesLabel({ name: "Bang!", kind: "collection", position: "248" }) === "Bang! collection · 248"`
    - with no position: `"Bang! collection"` and `"Malazan Book of the Fallen"`
  - **`bookScreenModel`:**
    - the work's series wins over the edition's collection;
    - the collection shows when the work has no series;
    - otherwise null.
  - **`booksService.test.ts`:**
    - A catalog with "Deadhouse Gates (The Malazan Book of the Fallen, Book 2)" (a title hit) plus "Gardens of the Moon" and "Memories of Ice", which carry only a Malazan series row: `search("malazan")` lists the title hit first, then the two series works. Every Malazan result carries `series.name === "Malazan Book of the Fallen"`.
    - The same with `{ byWork: true }`: one row per work.
    - A series work whose editions aren't searchable returns nothing.
    - A collection "Clássicos" with 200 searchable members plus 3 title hits for "clássicos": the 3 title hits come first and the total is capped at 12.
    - A book found by title and by series appears once.
    - `search("bang")` on a Bang! collection book whose work also has a story series carries `series.kind === "collection"`.
    - Two Bang! editions of one work give one row with `{ byWork: true }`.
  - **`works/service.test.ts`:** the work page carries `work.series`, and an edition's `collection`.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement.** In `backend/README.md`, add one paragraph to the search description covering series and collection matching and the group order.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm test --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`.
- [ ] **Step 5: Commit**: `Match series and collections in catalog search and carry them on results`.

### Task 3: Show the series in the apps

**Files:**
- Modify: `mobile/src/features/search/SearchResultRow.tsx`
- Modify: `mobile/src/features/library/components/AddBookForm.tsx`
- Modify: `frontend/src/components/AddBookModal.tsx`
- Modify: `mobile/src/features/works/BookScreen.tsx`
- Modify: `frontend/src/components/book/BookScreen.tsx`
- Modify: `mobile/src/features/search/SearchScreen.tsx`
- Modify: `mobile/src/features/search/searchModel.ts`
- Modify: `mobile/src/app/(app)/(search)/search.tsx`
- Test: `mobile/src/features/search/searchModel.test.ts`
- Modify: `mobile/README.md`

**Interfaces:**
- **Consumes:** `BookSeries`, `seriesLabel`, `BookSearchResult.series` and `BookScreenModel.series` from Task 2.
- **Produces:**
  - The Search route accepts `?q=<text>&t=<nonce>`. The book page passes `t: String(Date.now())`.
  - When `t` changes, `SearchScreen` sets the query to `q` and submits, so the outside search runs too. That holds even when the screen is already mounted, including with the same `q`.
  - The book page navigates to the Search tab's root screen (`router.navigate`, not `push`), so no second Search screen stacks. A second Search screen would drop the `receiveScans` registration (`scanBridge.ts:5-7`).
  - `mergeBookResults` (`searchModel.ts:133`) keeps an owned work's catalog result when the library section didn't list that work. A series hit for a book the reader owns therefore never vanishes.

- [ ] **Step 1: Write the failing tests** in `searchModel.test.ts`:
  - `mergeBookResults` keeps an owned work's catalog row when the library-section ids passed in don't include it, and still drops it when they do.
  - The pure helper `searchQueryFromParam(param: string | string[] | undefined): string | null`, which `SearchScreen` uses:
  - the trimmed string;
  - the first item of an array;
  - null for empty or undefined.
- [ ] **Step 2: Run it and see it fail.** Run `npm test --workspace mobile`.
- [ ] **Step 3: Implement:**
  - **Result rows:** a line `seriesLabel(result.series)` under the title, only when `series` is present. Use the existing caption style and one line (`numberOfLines={1}`) in the mobile Search row and in the mobile Add Book form rows, and the matching caption style in the web Add Book modal rows.
  - **Mobile book page:** the series line under the title.
    - Signed in: it's a link-styled caption that calls `router.push({ pathname: "/search", params: { q: model.series.name } })`.
    - Signed out (`signedIn` false): plain text.
  - **Web book page:** plain text.
  - **`mobile/README.md`:** add one sentence on the series line and the tap.
- [ ] **Step 4: Verify.** Run, in order:
  1. `npm run build --workspace @scripta/shared && npm run typecheck --workspace mobile && npm test --workspace mobile`
  2. `npm run typecheck --workspace frontend && npm run lint --workspace frontend && npm test --workspace frontend`
- [ ] **Step 5: Device pass** (the main session dispatches `device-checker`; it gates merge, not the PR). On a fixture with a series row, check:
  - the Search tab row shows "… · N";
  - tapping the book page line opens Search with the series name and results;
  - repeating the tap from another book replaces the query.
- [ ] **Step 6: Commit**: `Show a book's series on search results and the book page`.

### Task 4: Capture series from sources from now on

**Files:**
- Modify: `backend/src/modules/books/domain/series.ts`
- Test: `backend/src/modules/books/domain/series.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/src/modules/books/seed/bnpRecord.ts`
- Test: `backend/src/modules/books/seed/bnpRecord.test.ts`
- Modify: `backend/src/modules/books/seed/bnpImport.ts`
- Test: `backend/src/modules/books/seed/bnpImport.test.ts`
- Test: `backend/src/modules/books/seed/bnpScope.test.ts`
- Modify: `backend/src/modules/books/adapters/catalog/compositeCatalog.ts`
- Test: `backend/src/modules/books/adapters/catalog/compositeCatalog.test.ts`

**Interfaces:**
- **Produces, in `domain/series.ts`:**
  - `parseSeriesString(raw: string): SeriesEntry | null` handles:
    - "Name (3)";
    - "Name #3";
    - "Name, Book Three" or "Name, book 3" (word numbers one–twenty);
    - "Name ; 3";
    - "Name".
    - It trims, and drops an empty or punctuation-only name.
  - `seriesFromSubjects(subjects: unknown): SeriesEntry[]` reads strings starting with `series:` (case-insensitive) and replaces `_` with spaces before parsing.
- **Open Library edition records:** `EditionRecord` gains `series?: SeriesEntry[]`, from the edition JSON `series` array through `parseSeriesString`. Omit the field when empty, so the existing `deepEqual` tests hold.
- **Capture points:**
  - Edition `series` values: `addBookCollection(bookId, entry, "ol-edition", at)`. Task 1's `bestSeriesOf` promotes a matching name to the work's story series. They come from:
    - `backfillWorkKeys`, after `setWorkKey`;
    - `fetchDetails`'s edition JSON, carried as `CatalogDetails.editionSeries?: SeriesEntry[]` and saved in `lookupDetails`.
  - `series:` subjects: `addWorkSeries(workId, entries, "ol-subject", at)` for the book's current work. They come from:
    - the work subjects in `fetchDetails`, carried as `CatalogDetails.subjectSeries?: SeriesEntry[]`;
    - search-hit subjects in `saveHits`. `CatalogSearchHit` gains `subjectSeries?`, and `dropRepeats` (`compositeCatalog.ts:31-50`) copies a dropped Open Library repeat's `subjectSeries` onto the kept hit, as it does `workKey`.
- **BNP:**
  - `BnpBook` gains `collection: SeriesEntry | null`, from UNIMARC 225: `$a` is the name and the first `$v` is the position text. Update the full `BnpBook` literal in `bnpScope.test.ts:8`.
  - `applyBnpRecord` calls `addBookCollection(book.id, collection, "bnp", at)` inside its transaction, for new and matched books alike. That covers the daily sync and `lookupBnpIsbn`.

- [ ] **Step 1: Write the failing tests:**
  - **`parseSeriesString`:**
    - "Malazan Book of the Fallen (3)" gives `{ name: "Malazan Book of the Fallen", position: "3" }`;
    - "Dune Chronicles, Book 1" gives position "1";
    - "Bang!" gives position null;
    - "  ;  " gives null.
  - **`seriesFromSubjects`:** `["Fantasy", "series:Malazan_Book_of_the_Fallen"]` gives one entry named "Malazan Book of the Fallen".
  - **`openLibraryCatalog.test.ts`:** an edition record with `series: ["Malazan Book of the Fallen (3)"]` parses to `series`, and one without has no `series` key.
  - **`booksService.test.ts`:**
    - `backfillWorkKeys` on a book whose edition record has a series adds a `book_collections` row with source `ol-edition`.
    - With an `ol-subject` row of the same name on the work, `bestSeriesOf` returns it as the story series with the edition's position.
    - With "Penguin classics" alone, the work has no story series.
  - **`compositeCatalog.test.ts`:** a kept ISBNdb hit takes the dropped Open Library repeat's `subjectSeries`.
  - **`bnpRecord.test.ts`:** the fixture record with 225 "Obras de Eça de Queirós" `$v` 2 maps `collection` to `{ name: "Obras de Eça de Queirós", position: "2" }`, and "Antropos" maps with position null.
  - **`bnpImport.test.ts`:** applying that record adds a `book_collections` row.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`.
- [ ] **Step 5: Commit**: `Capture series and collections from Open Library and the national library`.

### Task 5: One-off fills for existing books

**Files:**
- Create: `backend/src/modules/books/seed/seriesFill.ts`
- Test: `backend/src/modules/books/seed/seriesFill.test.ts`
- Create: `backend/scripts/fill-series.mjs`
- Modify: `backend/src/modules/books/domain/translation.ts`
- Test: `backend/src/modules/books/domain/translation.test.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/seed/bnpImport.ts`
- Modify: `backend/package.json`
- Modify: `backend/README.md`

**Interfaces:**
- **Every fill takes `{ dryRun: boolean }` and writes nothing when it is true.**
- **Wikidata, `fillFromWikidata(repo, rows, at, { dryRun })`:**
  - `rows: Array<{ isbns: string[]; olWorkIds: string[]; series: string; position: string | null }>`.
  - It writes source `wikidata`, matched only through `findBookByKey("isbn:<canonical>")` (the book's work) or `ol_work_key`.
  - It returns `{ matched, added }`.
  - The SPARQL fetch lives in the script: P179 with optional P1545, ISBNs from P212/P957 on the work or its P629 editions, and P648 Open Library IDs (only `OL\d+W`). It pages by `ORDER BY ?work` with `LIMIT`/`OFFSET`, takes the series label in English and falls back to any label, and sends a User-Agent. The pure function does the matching.
- **Original titles, in two steps:** `listOriginalTitleSeries(repo)` returns candidates `{ name, workIds, titles }`. Then `fillFromOriginalTitles(repo, approvedNames: string[], at, { dryRun })` writes only the names a reviewer approved. The script's `originals --list` and `originals --apply <file.json>` wrap them.
  - It uses a new `seriesLikeGroups(claims)` in `domain/translation.ts`. That returns the same groups the #317 predicate uses (3 or more distinct Portuguese titles per original key plus surname), with each group's original title and member work ids.
  - `OriginalClaim` gains `workId`, and `originalTitleClaims` selects `work_id`.
  - It writes source `original-title` with no position.
- **BNP collections, `fillBnpCollections(deps, windows, { dryRun })`:**
  - The script takes `--from`/`--until`, defaulting to the import's `2000-01-01` and today.
  - `bnpImport.ts` exports `harvestWindow`.
  - For each month window, each kept record whose ISBN matches a catalog book gets `addBookCollection` from its 225.
  - No scans are downloaded and no book is created. It reports `{ windows, records, added, failedWindows }`.
- **Held works, `fillHeldEditions(repo, catalog, heldWorkIds, at, { dryRun })`:**
  - It maps held ids through `canonicalWorkIds` first (`booksService.ts:327`).
  - For editions with an ISBN in held works, it calls `fetchEditionRecord` (Open Library, throttled) and writes `ol-edition` collections.
  - It reports `{ asked, added }`.
- **`backend/scripts/fill-series.mjs wikidata|originals|bnp|held [--dry-run]`** runs one fill per call, prints a JSON report, and in `--dry-run` writes nothing. It follows `translation-backlog.mjs` for env checks and imports.

- [ ] **Step 1: Write the failing tests** in `seriesFill.test.ts`, on a fresh repo:
  - Wikidata rows match by ISBN and by Open Library ID, and a row with only a title matches nothing.
  - `listOriginalTitleSeries` lists "Princess Poppy" for 3 Portuguese editions that claim it.
  - `fillFromOriginalTitles(repo, ["Princess Poppy"], …)` writes it, and an unapproved candidate isn't written.
  - The BNP fill with a stubbed harvester adds a "Bang!" collection to the matching book and creates no book.
  - The held fill with a stubbed `fetchEditionRecord` adds an `ol-edition` row.
  - `--dry-run` writes nothing. Test the pure functions with a `dryRun` flag.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Add `seriesFill.test.ts` to `backend/package.json`.
  - Add a runbook paragraph to `backend/README.md`:
    - the order is wikidata → originals (`--list`, review, `--apply`) → held → bnp;
    - run each with `--dry-run` first, over `railway ssh … setsid`;
    - check `railway volume list --json` for free space before the bnp fill;
    - a deploy kills a running fill.
- [ ] **Step 4: Verify.** Run `npm run build --workspace @scripta/shared && npm run typecheck --workspace backend && npm test --workspace backend`.
- [ ] **Step 5: Commit**: `Fill series and collections for existing books`.
