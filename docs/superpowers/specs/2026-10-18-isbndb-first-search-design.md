# ISBNdb-first title search

## Problem

On 2026-10-17 at 20:58Z, a Search-tab search for "casa dos espiritos" showed no Portugal edition of Isabel Allende's *A Casa dos Espíritos*. There were three causes:

1. `compositeCatalog.search` alternates Open Library and ISBNdb hits and keeps 12, so only ISBNdb's first six survive. Porto Editora's edition (9789720044457) is ISBNdb's 9th hit. Open Library filled its six places with unrelated books such as "Soldados do Espirito Santo".
2. ISBNdb is paused for quota from about 02:30Z until 00:00Z on most days. Cover re-checks and other background calls spend the 5,000-call daily quota, and searches share it. On 10-17 the pause began at 02:29Z. While ISBNdb is paused, the composite treats it as an empty list, so the search returns Open Library alone with no log line.
3. Result rows show only title, author and year, so Brazilian and Portugal editions of the same book look identical.

## Decisions (user, 2026-10-18)

- ISBNdb prevails over Open Library in text search. ISBNdb's hits come first and Open Library fills the remaining places. ISBN searches already ask ISBNdb first, and that stays as it is.
- Keep 200 ISBNdb calls a day for searches. Every ISBNdb call that is not a search stops for the rest of the UTC day once 4,800 (5,000 − 200) have been made.
- Show the publisher on each result row: author · publisher · year.

## Design

### 1. Text search order

`createCompositeCatalog(primary, secondary).search({ text })` puts the secondary (ISBNdb) hits first, then the primary (Open Library) hits. It drops repeats by identity key, as today, and slices to `SEARCH_LIMIT`.

When a dropped Open Library repeat has a `workKey`, `olCoverId` or `result.coverUrl` that the kept ISBNdb hit lacks, the kept hit takes them. Without that, a book both sources return would lose the work key search saves today, and its row would lose the Open Library thumbnail (ISBNdb hits have `coverUrl: null`).

Failure handling is unchanged. If one source is down, the other's hits come back; if both are down, the search throws. The ISBN branch is unchanged too.

### 2. Daily reserve for searches

- `createIsbndbBudget(repo, limit, now)` in `adapters/isbndb/isbndbBudget.ts` returns a `() => void`.
  - Each call records one request through the existing persisted daily counter, `repo.spendTypesafe(utcDay(now()), "isbndb", limit)`.
  - When the day's count has reached `limit`, it throws `SourcePausedError("isbndb", …, { retryAt: nextUtcMidnight(now()) })`.
  - The `typesafe_usage` table is a plain (day, source, requests) counter. Persisting means a mid-day deploy doesn't reset the count, unlike the in-memory `capDailyCalls`.
- `createIsbndbGet` takes an optional spend. It calls it right before each HTTP request, inside the gate's inner `run` after the throttle, so one request counts once.
- `createIsbndbCatalog(apiKey, throttle, gate, urgent, spends = {})`, where `spends` is `{ details?: Spend; search?: Spend }`, chooses per method:
  - The foreground and background catalogs pass only `details`, so user searches stay free.
  - The retitle catalog passes `search` too, because the retitle job looks books up with `search({ isbn })`: up to 25 calls every 10 minutes, which would otherwise eat the reserve.
- `createIsbndbSource(apiKey, throttle, gate, spend?)`: both `byIsbn` and `byTitle` go through the spend.
- In `plugin.ts`:
  - New constants `ISBNDB_DAILY_QUOTA = 5000` and `ISBNDB_SEARCH_RESERVE = 200`.
  - One spend with limit `ISBNDB_DAILY_QUOTA - ISBNDB_SEARCH_RESERVE` is shared by:
    - the cover source;
    - the details of the foreground and background catalogs;
    - the retitle catalog's searches.
  - The background details cap (`capDailyCalls`, 500) stays as it is.
- User searches (`/books/search/external`) are not counted. The real quota still caps the day's total.
- A spent budget raises the same error `capDailyCalls` raises (`SourcePausedError` with a `retryAt`), and every caller already handles it:
  - The cover queue backs off until the `retryAt`.
  - `backfillDetails` pauses. `backfillWorkKeys` never calls ISBNdb.
  - The retitle job holds, as for a pause.
  - The composite's non-strict `fetchDetails` returns Open Library's answer when Open Library found the book. When Open Library found nothing, the error propagates and `GET /books/details` answers 502, as it does during today's quota pause, only now from 4,800 calls instead of 5,000.
- The gate does not pause on it, because it rethrows `SourcePausedError` without pausing, so searches keep running.

### 3. Publisher on result rows

`searchResultByline(result)` goes in `packages/shared/src/library/bookSearch.ts`. It returns `[result.authors.join(", "), result.publisher, result.year].filter(Boolean).join(" · ")`.

It is used by:
- the mobile Search tab row (`SearchResultRow.tsx`)
- the mobile Add Book form (`AddBookForm.tsx`)
- the web Add Book modal (`AddBookModal.tsx`)

Rows keep their one-line truncation.

## Out of scope

- Book details (`fetchDetails`) still ask Open Library first.
- Importing Portugal's national bibliography. That has a separate design session.
- The Open Library hit saved with another edition's ISBN (`mapOpenLibraryDoc` takes the first ISBN of a work-level doc).
- Caching searches.
- The publisher on an Open Library row is the work's first listed publisher, which may not match the row's ISBN, for the same reason as the item above. With ISBNdb first, Open Library rows only appear when ISBNdb returns fewer than 12 hits.
- A browser check of the web Add Book modal. The shared helper's test and the frontend typecheck cover a one-line join.

## Deploy

- Backend changes, plus client JS that reaches installed apps over the air.
- No new environment variable and no migration: `typesafe_usage` already exists.
- Older installed clients keep their old byline. The API is unchanged.

## Verification

- Unit tests in each task.
- After deploy:
  - Over the following UTC day, `railway logs … --filter "ISBNdb"` shows no `ISBNdb paused` line with reason `quota`.
  - A Search-tab search for "casa dos espiritos" lists Porto Editora 9789720044457 with its publisher.
