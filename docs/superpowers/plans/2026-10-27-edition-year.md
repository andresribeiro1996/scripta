# Edition Year Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `books.year` holds only an edition's own year. An Open Library hit's first-publication year moves to a new `books.first_published_year`, which the "first published" readers also count. A one-time copy and a background job repair existing rows, using Open Library's edition record for each exact ISBN.

**Architecture:**
- **One date parser:** `dateYear`, which feeds an optional `EditionRecord.year`.
- **Open Library details:** take the year from the edition record they already fetch.
- **Schema:** two columns, an index swap that keeps translation matching covered, and a version-6 copy.
- **Hits:** `saveHits` routes an Open Library hit's year to the new column.
- **Readers:** the three readers take the smaller of the two years.
- **Job:** `backfillEditionYears` mirrors `backfillWorkKeys`, including its 30-day recheck.

**Tech Stack:** Fastify + TypeScript + `node:sqlite`; `node:test` via `tsx --test`.

**Spec:** `docs/superpowers/specs/2026-10-27-edition-year-design.md`

## Global Constraints

- **`year` is the edition's own year, and nothing may blank it.** The job may replace a copied value only while `year = first_published_year` and only with a **greater** year. It may fill a null `year` with any year.
- **No ISBNdb calls** are added.
- **No API change.** The shared `WorkEdition`, `BookSearchResult` and `BookMetadata` types are untouched, and `firstPublishedYear` never leaves the backend (`backend/src/modules/works/service.ts:111` maps fields explicitly).
- **Year range:** 1450 to the current year, inclusive.
- **Job cadence:**
  - 50 rows per run (`DETAILS_BATCH_SIZE`) every `BACKFILL_INTERVAL_MS`
  - first run 42 s after boot (`FIRST_RUN_DELAY_MS.editionYearBackfill = 42_000`)
  - recheck after `WORK_RECHECK_MS` (30 days)
- **Code:** no comments in code. Each task ends with `npm run typecheck --workspace backend` and `node scripts/gate.mjs`.

## Review Focus

1. **The version-6 copy is one-time and copy-only.** A second boot changes nothing, and no `year` is set to null. Pinned in Task 2, from a real version-5 database.
2. **Translation matching stays on a covering index.** The `idx_books_work_editions` EXPLAIN test becomes `idx_books_work_years`. Pinned in Task 2.
3. **The job never lowers a copied year and never overwrites a year that changed after the copy.** Pinned in Task 3.
4. **"First published" readers lose nothing.** For every row, the work's earliest year and the translation-match year are less than or equal to what they were before. Pinned in Task 2 through the SQL path.
5. **ISBNdb dates parse as before.** `"20050802"` and `"2005-08-02T00:00:00Z"` still give 2005. Pinned in Task 1.

---

### Task 1: `dateYear`, and the year in Open Library's edition record

**Files:**
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Test: `backend/src/modules/books/domain/normalize.test.ts`
- Modify: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts`
- Test: `backend/src/modules/books/adapters/isbndb/isbndbCatalog.test.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts`
- Test: `backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`

**Interfaces:**
- Produces:
  - `dateYear(value: unknown): number | null` from `domain/normalize.ts`.
    - For a string whose first four characters are digits forming a year in range, it returns that year.
    - Otherwise it returns the first match of `/(?<!\d)(\d{4})(?!\d)/g` that is in range.
    - Non-strings give null.
  - `EditionRecord.year?: number`. `parseEditionRecord` sets it from `publish_date` only when `dateYear` finds one (`...(year !== null ? { year } : {})`), the way `series` is set. Every existing `EditionRecord` literal and `deepEqual` stays valid.
  - The Open Library `fetchDetails` result has `metadata.year = record.year ?? metadata.year` when an ISBN lookup fetched an edition record. Otherwise `metadata.year` stays as `buildBookMetadata` sets it (null).

- [ ] **Step 1: Write failing tests.**
  - In `normalize.test.ts`:
    - `"2005"`, `"20050802"`, `"2005-08-02T00:00:00Z"`, `"August 2, 2005"`, `"Aug 02, 2005"`, `"c2005"`, `"[2005]"` and `"0000, reprinted 2005"` all give 2005.
    - `"1449"`, a year after the current year, `"12345"`, `""`, `5`, `null` and `undefined` give null.
  - In `isbndbCatalog.test.ts`, beside `:75-82`: a record with `date_published: "20050802"` still yields year 2005.
  - In `openLibraryCatalog.test.ts`:
    - `parseEditionRecord` reads `publish_date: "March 2015"` as `year: 2015`, and omits `year` without one.
    - `fetchDetails` with an ISBN whose edition record has `publish_date: "2015"` returns `metadata.year === 2015`. Extend the ISBN case at `:80`.
    - The null-edition branch at `:86-88` keeps `metadata.year === null`.
    - Title and author details keep `metadata.year === null`.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/domain/normalize.test.ts src/modules/books/adapters/isbndb/isbndbCatalog.test.ts src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add `dateYear`.
  - Replace `yearOf` in `isbndbCatalog.ts` (`:15-18`, and its uses at `:30` and `:49`) with `dateYear`, then delete `yearOf`.
  - Add the optional `year` to `EditionRecord` and `parseEditionRecord`.
  - In `fetchDetails`, parse the edition record once with `parseEditionRecord(edition)`, reuse it for `editionSeries`, and when `edition` is not null set `metadata.year = record.year ?? metadata.year`.
  - Leave `seed/publisherFeed.ts`'s own `publicationYear` alone.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS, with the existing ISBNdb year cases (`isbndbCatalog.test.ts:75-82`, `:93-109`, `:117-120`) unchanged.

- [ ] **Step 5: Typecheck, gate, commit.**
  Run: `npm run typecheck --workspace backend && node scripts/gate.mjs`
  ```bash
  git add backend/src/modules/books/domain/normalize.ts backend/src/modules/books/domain/normalize.test.ts backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts backend/src/modules/books/adapters/isbndb/isbndbCatalog.test.ts backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.test.ts
  git commit -m "Read the edition year from Open Library's edition record"
  ```

### Task 2: `first_published_year`, the index swap, the one-time copy, hits and readers

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
- Test: `backend/src/modules/books/works.test.ts`
- Modify: `backend/src/modules/works/service.ts`
- Test: `backend/src/modules/works/service.test.ts`

**Interfaces:**
- Produces:
  - `BookRow.first_published_year: number | null` and `BookRow.edition_year_checked_at: string | null`.
  - `NewBook.firstPublishedYear?: number | null`, written by `createBook`.
  - `WorkPageRows["editions"][number].first_published_year: number | null`, selected by `pageEditionsStmt` (`sqliteBooksRepository.ts:278`).
  - `CatalogWorkPage.editions[].firstPublishedYear: number | null`.
  - `earliestYear` over every edition's `year` and `firstPublishedYear`.
  - The `matchCandidatesStmt` year (`:216`): `MIN(COALESCE(min(b.year, b.first_published_year), b.year, b.first_published_year))`.
  - `toSearchResult` year: `book.year ?? book.first_published_year`.
  - Index `idx_books_work_years ON books(work_id, year, first_published_year, language)`, replacing `idx_books_work_editions`.

- [ ] **Step 1: Write failing tests.**
  - `sqliteBooksRepository.test.ts`:
    - `version-6 copy fills first_published_year on Open Library rows only`. Following the upgrade pattern at `:1036-1046` and `:3126-3133`, take a migrated database and drop the new indexes. Then `ALTER TABLE books DROP COLUMN first_published_year`, the same for `edition_year_checked_at`, and set `user_version = 5`. Seed:
      - (a) `created_by` NULL, an ISBN, year 1954, data_sources `["openlibrary","isbndb"]`
      - (b) the same with data_sources `["isbndb"]`
      - (c) `created_by` `'bnp'`
      - (d) no ISBN
      - (e) year NULL

      Run `applyBooksMigrations`, then assert:
      - only (a) has `first_published_year = 1954`
      - every `year` is unchanged
      - `user_version` is 6
      - `idx_books_work_years` exists and `idx_books_work_editions` does not
      - a second `applyBooksMigrations` changes nothing
    - `createBook stores firstPublishedYear`.
    - `translation match year takes first_published_year when it is smaller`, extending the MIN case at `:1743-1759`.
    - Update the covering-index test at `:1734-1741` to expect `SEARCH b USING COVERING INDEX idx_books_work_years (work_id=?)`.
    - Update the index-column and index-name assertions at `:562`, `:1072-1081` and `:1682` to the new index.
    - Update the `user_version` 5 assertions at `:1520`, `:1966`, `:2000`, `:2025` and `:2042` to 6.
  - `saveHits.test.ts`:
    - An Open Library hit with `year: 1954` creates a row with `first_published_year 1954` and `year null`.
    - An ISBNdb hit with `year: 2015` creates `year 2015` and `first_published_year null`.
  - `booksService.test.ts`:
    - The case at `:855` (an inside search shows 1965) stays green through the fallback.
    - Add: a row with `year 2015` and `first_published_year 1954` shows 2015 in search.
  - `works.test.ts`: `getWorkPageWith returns firstPublishedYear from sqlite`, with editions `year 2015, first_published_year 1954` and `year 2001`, through a real repository.
  - `works/service.test.ts`:
    - `earliest year counts firstPublishedYear`, with editions `{year: 2015, firstPublishedYear: 1954}` and `{year: 2001, firstPublishedYear: null}`, giving 1954.
    - Add `firstPublishedYear: null` to the existing edition fixtures (`:25-26`, `:89-90`, the helper at `:157`, `:205`, `:215`).

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/saveHits.test.ts src/modules/books/booksService.test.ts src/modules/books/works.test.ts src/modules/works/service.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Add both columns to the `books` table in `books.sql`, and the matching `ALTER`s beside `work_checked_at` in `connection.ts:46`.
  - At `connection.ts:57`, after the `ALTER`s: `DROP INDEX IF EXISTS idx_books_work_editions`, then `CREATE INDEX IF NOT EXISTS idx_books_work_years ON books(work_id, year, first_published_year, language)`.
  - Add `copyFirstPublishedYears(db)` following `clearNonTitleOriginals` (`connection.ts:285-300`). It runs the spec's `UPDATE` and sets `user_version = 6` in one transaction, and is called from `applyBooksMigrations` right after the version-5 step.
  - Map the columns on `BookRow` and in `createBook`'s insert, and add `books.first_published_year` to `pageEditionsStmt` and `WorkPageRows`.
  - In `saveHits`: `source === "openlibrary"` → `{ year: null, firstPublishedYear: result.year }`; otherwise `{ year: result.year }`.
  - Add `firstPublishedYear: edition.first_published_year` in `works.ts:80`, and extend `earliestYear`.
  - Update `matchCandidatesStmt` and `toSearchResult`.

- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.

- [ ] **Step 5: Typecheck, full backend tests, gate, commit.**
  Run: `npm run typecheck --workspace backend && npm test --workspace backend && node scripts/gate.mjs`
  ```bash
  git add backend/src/modules/books/adapters/sqlite/books.sql backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/domain/types.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/saveHits.ts backend/src/modules/books/saveHits.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/works.ts backend/src/modules/books/works.test.ts backend/src/modules/works/service.ts backend/src/modules/works/service.test.ts
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
- Test: `backend/src/booksWiring.test.ts`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `EditionRecord.year` (Task 1), and the columns (Task 2).
- Produces:
  - `EDITION_YEAR_SQL`, exported beside `WORK_LOOKUP_SQL` (`sqliteBooksRepository.ts:46-54`) and shaped like it:
    ```sql
    SELECT id FROM books
    WHERE isbn IS NOT NULL AND first_published_year IS NOT NULL AND (year IS NULL OR year = first_published_year)
      AND (edition_year_checked_at IS NOT NULL) IN (0, 1)
      AND coalesce(edition_year_checked_at, '') < ?
    ORDER BY edition_year_checked_at IS NOT NULL, coalesce(edition_year_checked_at, ''), created_at, rowid
    LIMIT ?
    ```
  - `listEditionYearIds(limit: number, recheckBefore: string): string[]` on `BooksRepository`.
  - `setEditionYear(id: string, year: number | null, checkedAt: string): void` on `BooksRepository`. It runs the spec's write and stamps `edition_year_checked_at = $at`.
  - Index in `connection.ts`, beside `idx_books_work_queue` (`:68`) and after the `ALTER`s:
    ```sql
    CREATE INDEX IF NOT EXISTS idx_books_edition_year_queue ON books(edition_year_checked_at IS NOT NULL, coalesce(edition_year_checked_at, ''), created_at)
      WHERE isbn IS NOT NULL AND first_published_year IS NOT NULL AND (year IS NULL OR year = first_published_year)
    ```
  - `BooksService.backfillEditionYears(limit: number, signal?: AbortSignal): Promise<number | null>`. For each id from `listEditionYearIds(limit, now − WORK_RECHECK_MS)` it runs this body, copied from `backfillWorkKeys` (`booksService.ts:424-447`):
    - stop at once if the signal is aborted
    - skip a row with no ISBN
    - `record = await deps.editionRecords.fetchEditionRecord(isbn)`, then `setEditionYear(id, record?.year ?? null, now)`
    - on a `SourceUnavailableError`:
      - a `retryAt` → return it
      - a status of 429 → return `now + UNAVAILABLE_BACKOFF_MS`
      - anything else → `deps.warn({ bookId, source, error }, "edition year source unavailable")`, then `setEditionYear(id, null, now)`
    - rethrow any other error
    - return `null` when the run finishes
  - A job named "edition year backfill" in `plugin.ts`, beside "work key backfill" (`plugin.ts:225`).

- [ ] **Step 1: Write failing tests.**
  - `sqliteBooksRepository.test.ts`:
    - `listEditionYearIds` returns only rows that have an ISBN, have `first_published_year`, and have `year` null or equal to it. Unstamped rows come first, then stamps older than `recheckBefore`; fresher stamps are skipped.
    - `setEditionYear`:
      - replaces a copied `year` with a greater one
      - keeps it against a smaller or equal one
      - fills a null `year` with any year
      - keeps a `year` that differs from `first_published_year`
      - stamps in every case, including `null`
    - `the edition year queue uses its partial index`: the EXPLAIN QUERY PLAN of `EDITION_YEAR_SQL` names `idx_books_edition_year_queue`, in the style of the test at `:1681`.
    - Task 2's version-6 upgrade test drops `edition_year_checked_at`. SQLite refuses `DROP COLUMN` while an index uses the column, so add `DROP INDEX idx_books_edition_year_queue` before that `ALTER`.
  - `booksWiring.test.ts`: add `editionYearBackfill: 42_000` to the expected first-run delays.
  - `booksService.test.ts`, with the harness's `editionRecords`:
    - `the edition-year backfill replaces a copied year with the record's later year`.
    - `an earlier record year is refused, and the row is stamped`.
    - `a record without a year, or no record, stamps and leaves the row`.
    - `a 503 is warned and stamped`. Throw `SourceUnavailableError` with status 503; assert one warning and `edition_year_checked_at` set.
    - `a 429 returns a retry time and stamps nothing`.
    - `a year changed after the copy is kept`. Seed `year` null; between the listing and the write, fill it to 2010 with `mergeDetails`. Assert the result is 2010.
    - `a stamped row is asked again after 30 days`.
    - `the signal stops the run`.

- [ ] **Step 2: Run to verify failure.**
  Run: `cd backend && npx tsx --test src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts src/modules/books/booksService.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Implement** the SQL, the index, the two repository methods, the service method and the job registration (`FIRST_RUN_DELAY_MS.editionYearBackfill = 42_000`).

- [ ] **Step 4: Docs.** In `backend/README.md` `books`, add one bullet after "The work key lookup fills Open Library work keys by ISBN". It covers:
  - the two columns and what each means
  - where an edition year now comes from (Open Library's `/isbn/` `publish_date`, then ISBNdb)
  - the version-6 copy and the index swap
  - the job's selection, write rule (greater only) and 30-day recheck
  - no ISBNdb

  Also correct line 175's claim that the first-publication year isn't stored on an edition row: it is now stored, in `first_published_year`.

- [ ] **Step 5: Run, typecheck, gate, commit.**
  Run: `npm run typecheck --workspace backend && npm test --workspace backend && node scripts/gate.mjs`
  ```bash
  git add backend/src/modules/books/domain/ports.ts backend/src/modules/books/adapters/sqlite/connection.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts backend/src/modules/books/booksService.ts backend/src/modules/books/booksService.test.ts backend/src/modules/books/plugin.ts backend/src/booksWiring.test.ts backend/README.md
  git commit -m "Backfill edition years from Open Library edition records"
  ```
