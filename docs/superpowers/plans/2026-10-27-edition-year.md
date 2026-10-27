# Edition Year Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `books.year` holds only an edition's own year. An Open Library hit's first-publication year moves to a new `books.first_published_year`, which the "first published" readers also count. A one-time copy and a background job repair existing rows, using Open Library's edition record for each exact ISBN.

**Architecture:**
- **One parser:** `publicationYear`, which also feeds a new `EditionRecord.year`.
- **Open Library details:** take the year from the edition record they already fetch.
- **Schema:** two columns and a version-6 copy.
- **Hits:** `saveHits` routes an Open Library hit's year to the new column.
- **Readers:** the three readers take the smaller of the two years.
- **Job:** `backfillEditionYears` mirrors `backfillWorkKeys`.

**Tech Stack:** Fastify + TypeScript + `node:sqlite`; `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-27-edition-year-design.md`

## Global Constraints

- **`year` is the edition's own year, and nothing may blank it.** Only an Open Library edition-record year for the same ISBN may replace a copied value, and only while `year IS NULL OR year = first_published_year`.
- **No ISBNdb calls** are added.
- **No API change.** The shared `WorkEdition`, `BookSearchResult` and `BookMetadata` types are untouched.
- **Year range:** 1450 to the current UTC year, inclusive.
- **Job cadence:** 50 rows per run (`DETAILS_BATCH_SIZE`) every `BACKFILL_INTERVAL_MS`, first run 42 s after boot (`FIRST_RUN_DELAY_MS.editionYearBackfill = 42_000`).
- **Code:** no comments in code. Run `npm run typecheck --workspace backend`, then `node scripts/gate.mjs`, before claiming a task done.

## Review Focus

1. **The version-6 copy is one-time and copy-only.** A second boot changes nothing, and no `year` is set to null. Pinned in Task 2.
2. **The job never overwrites a year that changed after the copy** (a BNP or ISBNdb fill landing meanwhile). Pinned in Task 3.
3. **A failed request leaves the row unstamped.** An outage or 429 is retried later, not recorded as "checked". Pinned in Task 3.
4. **"First published" readers lose nothing.** For every row, the work's earliest year and the translation-match year are less than or equal to what they were before. Pinned in Task 2.

---

### Task 1: `publicationYear`, and the year in Open Library's edition record

**Files:**
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Test: `backend/src/modules/books/domain/normalize.test.ts`
- Modify: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`

**Interfaces:**
- Produces:
  - `publicationYear(value: unknown): number | null` from `domain/normalize.ts`. It returns the first match of `/(?<!\d)(\d{4})(?!\d)/` that falls in range. It scans past an out-of-range match to the next one, so `"1200-ish, 2005"` gives 2005.
  - `EditionRecord.year: number | null`, filled by `parseEditionRecord` from `publish_date`.
  - The Open Library `fetchDetails` result's `metadata.year` comes from the edition record's year when an ISBN lookup fetched one, and is otherwise left as `buildBookMetadata` sets it (null).

- [ ] **Step 1: Write failing tests.**
  - In `normalize.test.ts`:
    - `"2005"`, `"August 2, 2005"`, `"Aug 02, 2005"`, `"c2005"`, `"[2005]"`, `"2005-08-02T00:00:00Z"` and `"1200-ish, 2005"` all give 2005.
    - `"1449"`, a year after the current UTC year, `"12345"`, `""`, `5`, `null` and `undefined` give null.
  - In `openLibraryCatalog.test.ts`:
    - `parseEditionRecord` reads `publish_date: "March 2015"` as `year: 2015`, and gives `year: null` without one.
    - `fetchDetails` with an ISBN whose edition record has `publish_date: "2015"` returns `metadata.year === 2015`. Extend the existing ISBN details case (`openLibraryCatalog.test.ts:80`).
    - Title and author details (no edition fetch) keep `metadata.year === null`.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add `publicationYear`.
  - Replace `yearOf` in `isbndbCatalog.ts` (`:15-18`, and its uses at `:30` and `:49`) with `publicationYear`, then delete `yearOf`.
  - Add `year` to `EditionRecord` and `parseEditionRecord`.
  - In `fetchDetails`, after `buildBookMetadata`, set `metadata.year = parseEditionRecord(edition).year ?? metadata.year` when `edition` is not null. Parse the record once and reuse it for `editionSeries`.

- [ ] **Step 4: Run to verify pass.**
  Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts src/modules/books/adapters/isbndb/isbndbCatalog.test.ts`
  Expected: PASS, with the ISBNdb year tests (`isbndbCatalog.test.ts:75-81`, `:117-120`) unchanged.

- [ ] **Step 5: Typecheck and commit.**
  Run: `npm run typecheck --workspace backend`
  ```bash
  git add backend/src/modules/books/domain/normalize.ts backend/src/modules/books/domain/normalize.test.ts backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts
  git commit -m "Read the edition year from Open Library's edition record"
  ```

### Task 2: `first_published_year`, the one-time copy, hits and readers

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/saveHits.ts`
- Test: `backend/src/modules/books/saveHits.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/src/modules/books/works.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `backend/src/modules/works/service.test.ts`

**Interfaces:**
- Produces:
  - `BookRow.first_published_year: number | null` and `BookRow.edition_year_checked_at: string | null`.
  - `NewBook.firstPublishedYear?: number | null`, written by `createBook`.
  - `CatalogWorkPage.editions[].firstPublishedYear: number | null`.
  - `earliestYear` over every edition's `year` and `firstPublishedYear`.
  - `matchCandidatesStmt` year: `MIN(COALESCE(min(b.year, b.first_published_year), b.year, b.first_published_year))`.
  - `toSearchResult` year: `book.year ?? book.first_published_year`.

- [ ] **Step 1: Write failing tests.**
  - `sqliteBooksRepository.test.ts`:
    - `version-6 copy fills first_published_year on Open Library rows only`. Build a database at `user_version` 5, using the file's existing pattern for older-version fixtures. Seed:
      - (a) `created_by` NULL, an ISBN, year 1954, data_sources `["openlibrary","isbndb"]`
      - (b) the same with data_sources `["isbndb"]`
      - (c) `created_by` `'bnp'`
      - (d) no ISBN
      - (e) year NULL

      Run `applyBooksMigrations`, then assert:
      - only (a) has `first_published_year = 1954`
      - every `year` is unchanged
      - `user_version` is 6
      - a second `applyBooksMigrations` changes nothing
    - `createBook stores firstPublishedYear`.
    - `translation match year takes first_published_year when it is smaller`, extending the MIN case at `sqliteBooksRepository.test.ts:1743-1759`.
  - `saveHits.test.ts`:
    - An Open Library hit with `year: 1954` creates a row with `first_published_year 1954` and `year null`.
    - An ISBNdb hit with `year: 2015` creates `year 2015` and `first_published_year null`.
  - `booksService.test.ts`:
    - The existing case at `:855` (an inside search shows 1965) stays green through the fallback.
    - Add: a row with `year 2015` and `first_published_year 1954` shows 2015 in search.
  - `works/service.test.ts`: `earliest year counts firstPublishedYear`, with editions `{year: 2015, firstPublishedYear: 1954}` and `{year: 2001, firstPublishedYear: null}`, giving 1954. Use the case at `:185-199` as a pattern.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/saveHits.test.ts src/modules/books/booksService.test.ts src/modules/works/service.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add both columns to the `books` table in `books.sql`.
  - Add the matching `ALTER`s beside `work_checked_at` in `connection.ts:46`.
  - Add `copyFirstPublishedYears(db)` after the version-5 step, following `clearNonTitleOriginals`' pattern (`connection.ts:285-300`). It runs the spec's `UPDATE` and sets `user_version = 6` in one transaction, and is called from `applyBooksMigrations` after the version-5 step.
  - Map the new columns on the row and in `createBook`'s insert.
  - In `saveHits`: `source === "openlibrary"` → `{ year: null, firstPublishedYear: result.year }`; otherwise `{ year: result.year }`.
  - Add `firstPublishedYear: edition.first_published_year` in `works.ts:80`, and extend `earliestYear`.
  - Update `matchCandidatesStmt` and `toSearchResult`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck, full backend tests, commit.**
  Run: `npm run typecheck --workspace backend && npm test --workspace backend`
  ```bash
  git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/saveHits.ts backend/src/modules/books/saveHits.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/works.ts backend/src/modules/works/service.ts backend/src/modules/works/service.test.ts
  git commit -m "Keep an Open Library hit's first-publication year out of the edition year"
  ```

### Task 3: The edition-year backfill job

**Files:**
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `EditionRecord.year` (Task 1), and the columns (Task 2).
- Produces:
  - `listEditionYearIds(limit: number): string[]` on `BooksRepository`. It selects the spec's rows, oldest `created_at` first.
  - `setEditionYear(id: string, year: number | null, checkedAt: string): void` on `BooksRepository`. It runs `UPDATE books SET year = CASE WHEN $year IS NOT NULL AND (year IS NULL OR year = first_published_year) THEN $year ELSE year END, edition_year_checked_at = $at WHERE id = $id`.
  - `BooksService.backfillEditionYears(limit: number, signal?: AbortSignal): Promise<number | null>`. Its return value follows `backfillWorkKeys`: `null` when done, otherwise a retry time.
  - A job named "edition year backfill" in `plugin.ts`, beside "work key backfill" (`plugin.ts:225`).

- [ ] **Step 1: Write failing tests.**
  - `sqliteBooksRepository.test.ts`:
    - `listEditionYearIds` returns only rows that have an ISBN, have `first_published_year`, have `year` null or equal to it, and are unstamped, in `created_at` order.
    - `setEditionYear` replaces `year` when it equals `first_published_year`, keeps a `year` that differs, stamps either way, and stamps without change when given `null`.
  - `booksService.test.ts`, with the harness's `editionRecords`:
    - `the edition-year backfill replaces a copied year with the edition record's year`.
    - `a record without a year stamps and leaves the row`.
    - `no record (null) stamps and leaves the row`.
    - `an outage leaves the row unstamped and returns a retry time`. Throw `SourceUnavailableError` with status 429 and assert `edition_year_checked_at` is null.
    - `a year changed after the copy is kept`. Between the listing and the write, set `year` to 2010 with `mergeDetails` (fill-only, so seed `year` null for this case), and assert the result is 2010.
    - `the signal stops the run`.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Write the two repository methods, and a partial index:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_books_edition_year_queue ON books(created_at)
      WHERE edition_year_checked_at IS NULL AND first_published_year IS NOT NULL AND isbn IS NOT NULL
    ```
    It goes in `connection.ts` beside `idx_books_work_queue` (`:68`).
  - Write the service method, copying `backfillWorkKeys`' error handling (`booksService.ts:437-445`).
  - Register the job with `FIRST_RUN_DELAY_MS.editionYearBackfill = 42_000`.

- [ ] **Step 4: Docs.** In `backend/README.md` `books`, add one bullet after "The work key lookup fills Open Library work keys by ISBN". It covers:
  - the two columns and what each means
  - the version-6 copy
  - the job's selection
  - its write rule
  - no ISBNdb

  Also correct line 175's claim that the first-publication year isn't stored on an edition row: it is now stored, in `first_published_year`.

- [ ] **Step 5: Run, typecheck, gate, commit.**
  Run: `npm run typecheck --workspace backend && npm test --workspace backend && node scripts/gate.mjs`
  ```bash
  git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/plugin.ts backend/README.md
  git commit -m "Backfill edition years from Open Library edition records"
  ```
