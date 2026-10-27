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
3. **Open Library supplies the edition year from its edition record.** The details lookup already fetches `/isbn/{isbn}.json` (`backend/src/modules/books/adapters/openlibrary/openLibraryCatalog.ts:74`) and never reads `publish_date` from it. The year in `publish_date` now becomes the details' `year`. A new hit row gets its edition year at its first details lookup, from Open Library first and ISBNdb second (the composite's `have.year ?? extra.year`). A year nobody knows stays empty; an empty slot beats a wrong one.
4. **Repair copies; it never blanks.** BNP, the publisher importer and ISBNdb details fill `year` without leaving a reliable trace of which source wrote it:
   - `mergeDetails` records no source (`backend/src/modules/books/seed/bnpImport.ts:113`, `backend/src/modules/books/seed/importPublisherCovers.ts:309`).
   - A library row's `data_sources` lists `openlibrary` first once Open Library details land, even when ISBNdb wrote the year.

   So no stored year can be proven to be a hit's first-publication year. A one-time migration copies `year` into `first_published_year` on the rows that may hold one: `created_by IS NULL`, an ISBN, a year, and `openlibrary` as the first data source. It changes nothing a reader shows.
5. **A background job replaces a copied year only with a later Open Library year for that exact ISBN.**
   - It asks the edition record for each copied row whose `year` still equals `first_published_year`.
   - It replaces `year` only when the record's year is **greater** than `first_published_year`. A first-publication year is never later than any edition's year, so a genuine fix is never refused. A correct edition year that happened to be copied is only replaced by a later Open Library date for the same ISBN, never by an earlier one (a reprint record carrying the original's date).
   - A record with no year changes nothing.
   - It never spends ISBNdb, so rows Open Library doesn't know keep their old year.
   - It runs on the background Open Library lane, 50 rows every 10 minutes, with the same error handling and 30-day recheck as the work-key job (`backend/src/modules/books/booksService.ts:424-447`):
     - an outage other than a 429 is logged and stamped
     - a stamped row that still qualifies is asked again after 30 days
     - a 429 or a reset time pauses the run
6. **Search rows fall back.** A search row shows `year ?? first_published_year`. A row there is for recognising a book, and an Open Library hit's year is what the external results already show.
7. **One parser for Open Library and ISBNdb dates.** `dateYear(value)` reads the leading four digits when they are a year in range, as ISBNdb's private `yearOf` does today (`"20050802"`, `"2005-08-02T00:00:00Z"`). Otherwise it takes the first standalone four-digit year, from 1450 to the current year, which covers Open Library's free text ("August 2, 2005", "c2005", "[2005]"). It replaces `yearOf`. The publisher feed keeps its own stricter parser (`backend/src/modules/books/seed/publisherFeed.ts:128`, 1900 onwards), because shop attributes carry other four-digit numbers.

## Storage

On `books`, in `books.sql`, with matching boot `ALTER`s in `connection.ts`:
- `first_published_year INTEGER`
- `edition_year_checked_at TEXT`

The covering index that translation matching depends on, `idx_books_work_editions ON books(work_id, year, language)` (`connection.ts:57`), is replaced after the `ALTER`s by `idx_books_work_years ON books(work_id, year, first_published_year, language)`. Without that, the new `MIN` stops being covered and the 2.1 s stall fixed in 4da434b returns.

The one-time copy runs once, under `PRAGMA user_version` 6, after the existing version-5 step:
```sql
UPDATE books SET first_published_year = year
WHERE created_by IS NULL AND isbn IS NOT NULL AND year IS NOT NULL
  AND first_published_year IS NULL AND json_extract(data_sources, '$[0]') = 'openlibrary'
```

## The job

`backfillEditionYears(limit, signal)` mirrors `backfillWorkKeys`.

**Selection:**
- the row has an ISBN
- `first_published_year IS NOT NULL`
- `year IS NULL OR year = first_published_year`
- `edition_year_checked_at` is null or more than 30 days old
- unstamped rows first, then the oldest stamp, then the oldest `created_at`

This mirrors `WORK_LOOKUP_SQL` (`sqliteBooksRepository.ts:46-54`), served by a partial index whose `WHERE` holds the first three conditions.

**Write:**
```sql
year = CASE WHEN $year IS NOT NULL
             AND (year IS NULL OR (year = first_published_year AND $year > first_published_year))
            THEN $year ELSE year END
```
The same statement stamps `edition_year_checked_at`. The write re-checks the condition, so a fill that landed meanwhile wins.

The job is registered beside the work-key backfill.

## Readers

- **Work hero.**
  - `pageEditionsStmt` (`sqliteBooksRepository.ts:278`) and `WorkPageRows` select `first_published_year`.
  - `CatalogWorkPage.editions[]` gains `firstPublishedYear`.
  - `earliestYear` takes the minimum over every edition's `year` and `firstPublishedYear`.
  - It is mapped out before the API (`backend/src/modules/works/service.ts:111`), so clients see no new field.
- **Translation matching.** `MIN(b.year)` becomes the minimum, over rows, of each row's smaller set value.
- **Search rows.** `toSearchResult` (`booksService.ts:177`) uses `year ?? first_published_year`.

## Not in this release

- ISBNdb lookups for rows Open Library doesn't know (mostly Portuguese editions).
- ISBN-less Open Library rows already stored, including award-import rows. They keep the first-publication year in `year`, because there is no edition to ask about. New ISBN-less Open Library hits store it only in `first_published_year`, so their edition strip shows no year.
- Changing what external Open Library search results show.
- A source column for `year`.
- Renaming "earliest edition" in the Jev work-match prompt.

## Deploy impact

- **Boot:**
  - two `ALTER`s
  - the index swap (one build over `books`)
  - a one-time `UPDATE`
- **Job load:** at most 50 Open Library edition-record requests every 10 minutes, on the background lane. Rows Open Library answers without a year are asked again monthly.
- **API:** no route or field changes.

## Tests

- **`dateYear`:**
  - leading digits (`"20050802"`, `"2005-08-02T00:00:00Z"`)
  - free text (`"August 2, 2005"`, `"c2005"`, `"[2005]"`)
  - an out-of-range leading run followed by a valid year
  - out-of-range values and non-strings
- **Open Library details:** take the year from `publish_date`; keep null when the edition record is null or has none.
- **`saveHits`:**
  - An Open Library hit writes `first_published_year` and leaves `year` null.
  - An ISBNdb hit writes `year`.
- **Migration:** run from a real version-5 database without the columns. It copies only matching rows, swaps the index, and runs once.
- **Readers:**
  - The work's earliest year counts `first_published_year`, through the SQL path.
  - The translation-match year counts it too, and stays on the covering index.
  - Search rows fall back.
- **Job:**
  - It replaces a copied year with a later one.
  - It refuses an earlier one.
  - It fills a null year.
  - A record with no year stamps and changes nothing.
  - It never overwrites a year that changed meanwhile.
  - A 503 is logged and stamped.
  - A 429 pauses without stamping.
  - Its query uses the partial index.
- **Existing tests stay green:** `booksService.test.ts:649-660` (fill-only) and `:855` (an inside search shows a saved hit's year).
