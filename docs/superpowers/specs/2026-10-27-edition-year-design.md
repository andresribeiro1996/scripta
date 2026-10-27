# Edition year — design

## Why

`books.year` is meant to be the year this edition came out: the edition strip shows it as "lang · year · isbn" (`packages/shared/src/works/labels.ts:21`). But a book that enters the catalog from an Open Library search hit stores the work's `first_publish_year` there (`packages/shared/src/library/bookSearch.ts:137` → `backend/src/modules/books/saveHits.ts:31`). Every later fill is fill-only (`year = COALESCE(year, $year)`, `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts:338`), so ISBNdb's edition year never replaces it. A 2015 Portuguese edition of a 1954 book shows 1954.

The same column also feeds two "first published" readers, both as the earliest edition year:
- the work hero (`earliestYear`, `backend/src/modules/works/service.ts:38-41`)
- translation matching (`MIN(b.year)`, `sqliteBooksRepository.ts:216`)

Those readers rely on the hit's first-publication year today. Simply dropping it would make "first published" read "earliest edition we happen to hold".

## Decisions

**From the user (2026-10-27):** fix it.

**Builder's calls (Claude's, each open to the user's override):**
1. **Two columns, one meaning each.**
   - `books.year` holds only an edition's own year.
   - A new `books.first_published_year` holds the first-publication year an Open Library search hit reported.
   - Both "first published" readers take, per row, the smaller of the two that are set. The edition strip and labels keep reading `year`.
2. **Open Library hits stop writing `year`.** `saveHits` writes the hit's year to `first_published_year` when the hit's `source` is `openlibrary`, and leaves `year` null. ISBNdb hits, whose year comes from the edition's `date_published` (`backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts:30`), keep writing `year`.
3. **Open Library supplies the edition year from its edition record.** The details lookup already fetches `/isbn/{isbn}.json` (`backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts:74`) and never reads `publish_date` from it. The year in `publish_date` now becomes the details' `year`. A new hit row gets its edition year at its first details lookup, from Open Library or, failing that, ISBNdb. A year nobody knows stays empty; an empty slot beats a wrong one.
4. **Repair copies; it never blanks.** BNP and the publisher importer fill `year` through `mergeDetails`, which doesn't record a source (`backend/src/modules/books/seed/bnpImport.ts:113`, `backend/src/modules/books/seed/importPublisherCovers.ts:309`). So no stored year can be proven to be a hit's first-publication year. A one-time migration copies `year` into `first_published_year` on the rows that may hold one: `created_by IS NULL`, an ISBN, a year, and `openlibrary` as the first data source. It changes nothing a reader shows.
5. **A background job replaces a copied year only with Open Library's year for that exact ISBN.**
   - It asks the edition record for each copied row whose `year` still equals `first_published_year`. When the record has a year, it becomes `year`.
   - When the record has none, the row is stamped and left alone, because the old value may be a correct BNP or ISBNdb year.
   - It uses the background Open Library lane, 50 rows every 10 minutes, the same cadence as the work-key job.
   - It never spends ISBNdb, so rows Open Library doesn't know keep their old year.
6. **Search rows fall back.** A search row shows `year ?? first_published_year`. A row there is for recognising a book, and an Open Library hit's year is what the external results already show.
7. **One year parser.** `publicationYear(value)` takes the first standalone four-digit year from 1450 to the current year. It covers Open Library's free-text dates ("August 2, 2005", "c2005", "[2005]") and ISBNdb's "2005-08-02T00:00:00Z", and replaces ISBNdb's private `yearOf`.

## Storage

On `books`, in `books.sql`, with matching boot `ALTER`s in `connection.ts`:
- `first_published_year INTEGER`
- `edition_year_checked_at TEXT`

The one-time copy runs once, under `PRAGMA user_version` 6, after the existing version-5 step:
```sql
UPDATE books SET first_published_year = year
WHERE created_by IS NULL AND isbn IS NOT NULL AND year IS NOT NULL
  AND first_published_year IS NULL AND json_extract(data_sources, '$[0]') = 'openlibrary'
```

## The job

`backfillEditionYears(limit, signal)` mirrors `backfillWorkKeys` (`backend/src/modules/books/booksService.ts:424-445`).

**Selection:**
- the row has an ISBN
- `first_published_year IS NOT NULL`
- `year IS NULL OR year = first_published_year`
- `edition_year_checked_at IS NULL`
- oldest `created_at` first

**For each row:**
- It asks `editionRecords.fetchEditionRecord(isbn)`.
- It writes `year = record.year` only while the row still qualifies, `(year IS NULL OR year = first_published_year)`, so a fill that landed meanwhile wins.
- It stamps `edition_year_checked_at` on any answer, including no record.
- On `SourceUnavailableError`, it leaves the row unstamped and backs off exactly as `backfillWorkKeys` does (honouring `retryAt`, and a 429 backoff).

The job is registered beside the work-key backfill and logs like it.

## Readers

- **Work hero.** `CatalogWorkPage.editions[]` gains `firstPublishedYear`, and `earliestYear` takes the minimum over every edition's `year` and `firstPublishedYear`. The shared `WorkEdition` type and the client fields are unchanged.
- **Translation matching.** `MIN(b.year)` becomes the minimum, over rows, of each row's smaller set value.
- **Search rows.** `toSearchResult` (`booksService.ts:177`) uses `year ?? first_published_year`.

## Not in this release

- ISBNdb lookups for rows Open Library doesn't know.
- Changing what external Open Library search results show.
- A source column for `year`.

## Deploy impact

- **Boot:** two `ALTER`s and a one-time `UPDATE` at the first boot.
- **Job load:** the new job adds at most 50 Open Library edition-record requests every 10 minutes, on the background lane, until the copied rows are checked.
- **API:** no route or field changes.

## Tests

- **`publicationYear`:** each format above; years outside 1450 to now; non-strings.
- **Open Library details:** take the year from `publish_date`; null without an edition record.
- **`saveHits`:**
  - An Open Library hit writes `first_published_year` and leaves `year` null.
  - An ISBNdb hit writes `year`.
- **Migration:** copies only matching rows, and runs once.
- **Readers:**
  - The work's earliest year counts `first_published_year`.
  - The translation-match year counts it too.
  - Search rows fall back.
- **Job:**
  - It replaces a copied year.
  - It leaves a row with no record stamped and unchanged.
  - It never overwrites a year a fill changed meanwhile.
  - It backs off on an outage, without stamping.
- **Existing tests stay green:** `booksService.test.ts:649-660` (fill-only) and `:855` (an inside search shows a saved hit's year).
