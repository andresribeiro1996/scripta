# Hardcover catalog enrichment — design

## Why

Production has 234k editions, about 155k of them Portuguese BNP editions. Many editions have no synopsis, most works have no series, and about 101k editions have empty genres. Hardcover (https://hardcover.app) is a community book database with a GraphQL API. Its librarians curate series with positions, and its books carry descriptions and community genre tags.

On 2026-10-25 a read-only production sample took 300 random books from each gap group and looked them up on Hardcover by exact ISBN. It matched:
- 16% of random books;
- 8% of Portugal ISBNs;
- 4% of books without covers;
- 79% of books in readers' libraries.

The estimated gains:
- about 29k new descriptions, before the language filter below;
- about 11.7k books gaining a series;
- about 10.5k empty-genre books gaining genres, about 10% of the 101k.

Among owned books, about 10% gain a series and 12% a description. Owned books are what readers actually open, so they are the main win.

## Terms of use (checked 2026-10-25)

The terms are on two pages, the API getting-started page (https://docs.hardcover.app/api/getting-started/, source in `hardcoverapp/hardcover-docs` on GitHub) and the "API Rules" section of https://hardcover.app/pages/policies.

- **Copyright:** Hardcover asserts no copyright over its database ("same licensing as OpenLibrary"). A personal project "can use any data you get from the API".
- **Commercial products and publicly accessible websites** may not use data owned by users:
  - libraries, reviews, individual ratings, dates read;
  - journals, prompts, lists, vibes, goals, follows.
- **Aggregates and facts:** aggregate data is allowed when it is credited as Hardcover data ("average Hardcover rating"). Facts about books, editions and series are allowed even for professional projects.
- **LLMs:** the data must not be used to train public or commercial LLMs.
- **Images:** they are user-uploaded, so publishing them needs a DMCA policy. Covers are out of scope here.

Scripta is a personal project: not charged for, not incorporated, no ads. It still has accounts and public share links, so this design reads it as a publicly accessible website. It stores book facts (series, position, description) and one aggregate (genre tags, reduced to our own genre vocabulary). It never stores anything per-user. Nothing here trains a model. The synopsis judgment pass sends a description to Jev for a usability score, which is inference, not training.

## Decisions

**From the brief (2026-10-25):**
- Scope:
  - series with positions into `work_series`, as a new source `hardcover`;
  - descriptions as a synopsis source;
  - Hardcover's Genre tags into empty `books.genres`, mapped to our vocabulary.
- Out of scope:
  - covers (Hardcover's are mostly about 300 px, below our 400 px bar);
  - authors (they would fill only about 40 books).
- Lookup is by exact ISBN only, 50 ISBNs per request, with the query in Data below.
- The token lives in a Railway variable that the user sets. It is never committed.

**Builder's calls (Claude's, each open to the user's override):**

1. **Moods and community ratings are not stored.**
   - Nothing in the app could show moods, so storing them now would be a speculative feature.
   - A rating would need columns of its own, because `books.rating` is Open Library's and every details save overwrites it (`sqliteBooksRepository.ts:342`). It would also need a "on Hardcover" credit line in the Stats screen of both clients, which is a UI feature this brief doesn't ask for.
   - Re-fetching the catalog later for either is one day's quota (about 4,700 requests). Keeping raw responses "just in case" saves less than it costs.
2. **A script, not a server job.** `node scripts/fill-hardcover.mjs` follows `fill-series.mjs` and `fill-awards.mjs`. It runs over `railway ssh` from the deployed `dist`.
   - There is no daily job.
   - Books added after the run get Hardcover data only when the script runs again. The README says to re-run it after large imports.
   - A daily job for newly held works is a follow-up, if the user wants one.
3. **Hardcover ranks second for series, after Wikidata.** The ranks become `wikidata` 0, `hardcover` 1, `ol-edition` 2, `ol-subject` 3, `original-title` 4.
   - A work that already shows a Wikidata series keeps it. Hardcover fills the gaps and outranks Open Library's messier edition and subject strings.
   - In `bestSeriesOf`, an edition collection whose name matches a `hardcover` series supplies its position, as it already does for `wikidata` and `ol-subject` (`sqliteBooksRepository.ts:1327-1330`).
4. **One series per Hardcover book: its featured series.** The SeriesSource type and the rank table live in `backend/src/modules/books/domain/series.ts:3,7`. The featured series comes from `cached_featured_series` (jsonb) if Task 1 finds it carries the name and position. Otherwise it is `featured_book_series`, and then the sole `book_series` row when there is exactly one. Hardcover's roadmap caps query depth at 3, and `editions → book → featured_book_series → series` is depth 4, so the jsonb form comes first.
   - This stops a Stormlight book from showing "The Cosmere" when both are stored under the same source.
   - The umbrella series is lost from search for now.
   - Rows with `compilation = true` are kept, since their position is the first book's, and our work may be the omnibus.
   - Only one Hardcover series is ever stored per work. The series step is skipped when the work already has a `hardcover` row (`hasWorkSeries(workId, "hardcover")`, a new repository read), so a resumed or repeated run never adds a second one. Two editions of one work can match different Hardcover books, for example an omnibus and a single volume. Without the set, both series would be stored under `hardcover`, and `bestSeriesOf` would pick between them by `created_at`, which is arbitrary.
   - A position Hardcover changes later isn't updated. `addWorkSeries` only fills a NULL position, as for Wikidata.
5. **Series names go through a review list, before and after the run.**
   - The dry run on a sample lists series names with work counts. A real run refuses to start without `--skip <names.json>`, which may hold `[]`. This mirrors `fill-series.mjs:41`, because a community database also holds publisher collections ("Penguin Classics").
   - The sample covers only the first ~25k editions in rowid order, so the real run's report also lists `seriesNames`, for every name it added. The user and Claude review that full list.
   - Names rejected after the run are removed with `--remove <names.json>`. It costs no requests, and it deletes the `hardcover` rows with those name keys (`removeWorkSeries(nameKeys, "hardcover")`, a new repository write). It also deletes their `series_fts` rows when no other source keeps that name on the work, since `series_fts` is only written for a work's first row of a name key (`sqliteBooksRepository.ts:497-500`). Hand SQL would leave search finding the work under the deleted name.
6. **Descriptions are written per edition, only when the edition shows no synopsis today, and only when the language is known to match.**
   - They are written through the existing `mergeDetails(bookId, { summary, pages: null, year: null, publisher: null, translator: null }, "hardcover")`. Its first-write-wins rule keeps any existing synopsis.
   - **"Shows no synopsis today"** means `books.summary` is empty and the work has no `works.summary` with an `ol_work_key`. The details read prefers the edition's own summary over the Open Library work summary (`booksService.ts:150-161`), and a boot migration cleared edition summaries where the work holds one (`connection.ts:130-136`). Writing into those empty edition rows would hide a synopsis readers already see, so they count as `alreadyHadSummary`. When the work summary is in the other language and hidden by the language check, this skips an edition that shows nothing. The rule accepts that loss, because it is simpler than re-running the read path's check.
   - Hardcover keeps a description on the book, which matches our work, and usually in English.
   - **The language rule is stricter than `summaryMatchesLanguage`**, which passes any language other than pt or en (`languageFilter.ts:21-25`). The edition's language is:
     - `book.language`;
     - else `pt` for a Portuguese ISBN;
     - else `en` for an English-area ISBN group (978-0, 978-1, 979-8);
     - else unknown.
     The description is written only when `detectedLanguage(text)` (made exported from `languageFilter.ts`) equals that language. An unknown or undetectable language writes nothing. So a French edition, or a 978-3 edition with no language, never gets an English blurb.
   - **This cuts the 29k estimate.** Most of the 8% Portugal-ISBN matches will be dropped. The dry run reports the drop as `descriptionWrongLanguage`.
   - Only the matched edition is written. Its sibling editions keep reading their own summary, or the Open Library work summary, as today.
7. **Genres reuse the source-genre fill.**
   - Hardcover Genre tags go through `normalizeBookGenres` (`packages/shared/src/library/bookGenres.ts:77`), which already maps English genre labels to the 26-genre vocabulary.
   - The result goes through `fillSourceGenres(workId, genres)` (`backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts:262`), exactly as `seedGenres.ts` and `feedGenres.ts` do.
   - It fills only editions whose `genres` is `'[]'`, with `genres_source = NULL`, so the jev, manual and NULL guards are unchanged.
   - A work's genres are taken from the first matched edition whose tags map to at least one genre. A run-wide set marks a work only once that non-empty result has been written, so an edition whose tags map to nothing doesn't block a sibling that has some.
8. **Only well-supported tags count.**
   - A Genre tag is used when its `count` is at least `GENRE_MIN_COUNT` and at least `GENRE_MIN_SHARE` of the top tag's count.
   - At most `GENRE_LIMIT` genres per work are kept, after mapping.
   - **Calibration happens before any code, locally, with the user's token.**
     - The plan's first task fetches about 200 Hardcover books by random `id` (`books(where: {id: {_in: [...]}})`), skipping missing ids, along with their `cached_tags` and descriptions.
     - Claude labels each book's correct genres from our vocabulary, then picks the three constants that best match the labels, and records the numbers and the agreement in the plan.
     - Until then the defaults are 2, 0.2 and 3.
     - The same sample answers the description question in Decision 13.
     - The dry run's `genreSamples` (runbook step 3) is a second look on catalog books. A threshold change after that goes through a normal PR and deploy before the real run.
9. **The summary source is `hardcover`, and nothing in the UI credits it.**
   - `SummarySource` (`backend/src/modules/books/domain/types.ts:3-4`) gains `"hardcover"`, and so does the shared `BookMetadata.summarySource` union (`bookMetadata.ts:23`).
   - `summaryLink` (`backend/src/modules/books/booksService.ts:144`) returns `""` for it, as for `bnp`, since the Hardcover slug isn't stored. The web summary therefore shows no "Source:" link. That is what BNP summaries show today.
   - The web summary renders its "Source:" line only when `sourceUrl` is non-empty (`frontend/src/components/BookSummary.tsx:55`), so `summarySourceName` doesn't change.
   - **The terms need no credit here.** Descriptions are facts about books, which the terms allow even for professional projects. The credit rule covers aggregate figures shown as such ("average Hardcover rating", "number of Hardcover readers"). Our genres are our own 26-genre classification, chosen with tag counts as one input, and no Hardcover figure is displayed. A later feature that shows a Hardcover number (a rating, a reader count, mood percentages) must credit it.
   - The change is additive. Mobile doesn't render the source.
10. **One pass over every edition with an ISBN, in rowid order, resumable.**
    - Pages are 50 editions with a non-null `isbn`. The cursor is the last rowid.
    - There is no gap filter: the run is about 4,700 requests, inside one day's quota, and most editions lack something.
    - `--after <rowid>` resumes. `--max-requests <n>` caps a run, and the dry run is used with it.
    - Every report and every stderr progress line carries `lastRowid`.
11. **Pacing:**
    - one request per 1.1 s, which is 60 a minute and never touches the burst of 10;
    - one write transaction per page, so writes come about a second apart and never starve the server's lock (see the cross-process starvation note in `bnpImport.ts` / #311);
    - `waitForBnpLock` before starting, as `fill-awards.mjs` does.
12. **The token is `HARDCOVER_API_TOKEN`.**
    - The script reads it from `process.env`, as `fill-awards.mjs` reads `COVERS_DB_PATH`, and exits with a message when it is missing.
    - It goes into `.railway/railway.ts` as `HARDCOVER_API_TOKEN: preserve()`, so `railway config apply` keeps it.
    - It is not added to `env.ts`, because the server never reads it.
    - Locally it lives in the worktree's `backend/.env`, which git ignores.
13. **Descriptions go through `htmlToText`** from `@scripta/shared`, as ISBNdb's do (`backend/src/modules/books/adapters/isbndb/isbndbCatalog.ts:12`). `mergeDetails` then applies `cleanSummary`.
    - The calibration sample in Decision 8 shows what Hardcover descriptions hold: HTML, markdown, or boilerplate such as "From the publisher".
    - Any boilerplate seen in more than a handful of the sample gets a rule in the same task, with a test. Anything rarer is left to the synopsis judgments.

## Data

### The query

One top-level field, so one request against the quota:

```graphql
query Editions($i13: [String!]!, $i10: [String!]!) {
  editions(where: { _or: [{ isbn_13: { _in: $i13 } }, { isbn_10: { _in: $i10 } }] }) {
    isbn_13
    isbn_10
    book {
      id
      book_status_id
      canonical_id
      description
      cached_tags
      cached_featured_series
    }
  }
}
```

- **The ISBN lists.** `$i13` holds the page's ISBN-13s (`books.isbn` is always canonical ISBN-13, `bookMatch.ts:55-61`). `$i10` holds the ISBN-10 of each 978- ISBN, because some Hardcover editions carry only one of the two.
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`, and the backend's `USER_AGENT` (`http.ts:4`), which is what Hardcover asks for.
- **Unverified shapes.** The plan's first task checks these against the live API with the user's token before any code is written:
  - what `cached_featured_series` holds. If it lacks the name or position, use `featured_book_series { position compilation series { name } }` and `book_series { … }`, provided the depth isn't rejected;
  - the real 401/403 body (from a bad token) and the `RateLimit` header format;
  - the `cached_tags` shape: expected `{ "Genre": [{ "tag": "Fantasy", "count": 41, ... }], "Mood": [...], ... }`;
  - the response time at 50 ISBNs. The client's default timeout is 10 s (`http.ts:3`), so `postJson` takes a `timeoutMs` and the Hardcover lookup passes 30 000, which is Hardcover's own query limit.

### Matching

- **Reading a response:** each returned edition is matched back through its `isbn_13`, or through the ISBN-13 of its `isbn_10` (`canonicalIsbn`), using a page-local map from ISBN to the page's editions.
- **Duplicate ISBNs:** `books.isbn` has no unique constraint and no index (`books.sql:18`), so two of our editions can share an ISBN. Every edition in the page with that ISBN gets the description, if its summary is empty.
- **Usable books:** a Hardcover book is used only when `book_status_id = 1` (OK) and `canonical_id` is null. A deleted or deduped book is skipped and counted as `skippedBooks`.
- **Several Hardcover editions for one ISBN:** the first usable one wins, and the rest are counted in `duplicateIsbns`.
- **Writes go to the edition's live work.** That is `books.work_id` resolved through `canonicalWorkIds`, the same way series reads roll up merged works.

### Writes, per page, in one transaction

- **Series:** `addWorkSeries(workId, [entry], "hardcover", at)` for the featured series, unless its name key is in the skip list.
  - `entry.position` is the float formatted without a trailing `.0`: 1 → "1", 1.5 → "1.5", null → null.
  - `addWorkSeries` already ignores repeats and fills a NULL position for the same source (`sqliteBooksRepository.ts:1277-1294`).
- **Description:** `mergeDetails(...)` as in Decision 6, after `htmlToText` (Decision 13). A description shorter than 40 letters is still written. The synopsis judgment's fragment rule (`synopsis.ts`) hides it, as it does for every other source.
- **Genres:** `fillSourceGenres(workId, genres)` as in Decisions 7 and 8.

In a dry run the database is opened read-only, as `fill-series.mjs:124` does. The counts come from the same checks without writing:
- the summary is empty and the language matches;
- `countEmptyGenreEditions(workId) > 0`;
- a series entry not on the skip list counts as added. Before the first real run no `hardcover` rows exist, so the count is exact then.

## The script

`node scripts/fill-hardcover.mjs [--dry-run] [--skip <names.json>] [--after <rowid>] [--max-requests <n>]`, or `node scripts/fill-hardcover.mjs --remove <names.json>` (no requests, no token needed)

- **Output:** the JSON report goes to stdout, and progress goes to stderr as JSON lines every 20 requests. This is the same split as `fill-series.mjs`.
- **Refusals:** a real run without `--skip` refuses, as Decision 5 says.
- **Errors:**
  - **401 or 403** ends the run at once with the API's `error` field, for example `invalid_token`, `insufficient_scope` or `request_exceeds_capacity`.
  - **429:** a short `Retry-After` (≤ 120 s) is waited out, up to 3 attempts. A 429 with no `Retry-After` waits 60 s, one per-minute window, and counts as an attempt. A longer `Retry-After` ends the run cleanly with `stoppedBy: "daily-quota"` and `lastRowid`. Hardcover sends `Retry-After` on every 429, and a spent daily quota points it at midnight UTC.
  - **5xx, 408 and network errors** (status ≥ 500, 408, or no status) retry 3 times with 30 s between tries. Any other 4xx ends the run at once. After that the run ends with `stoppedBy: "error"` and `lastRowid`. Nothing is swallowed.
  - **GraphQL `errors` in a 200 response** end the run at once, never retried, with the message.
- **Re-runs are safe.** Every write is add-only or fill-empty.

### The client

A new `postJson(source, url, body, headers, timeoutMs)` in `backend/src/modules/books/adapters/http/http.ts` reuses the private `request`, `failure` and `readBody` helpers, so 429 `Retry-After` parsing isn't written twice. Hardcover's daily stop is decided from `retryAt`, not from `failure()`'s ISBNdb-style `remaining=` quota flag. `request` gains an optional method and body, and the existing `fetchJson` callers don't change.

The Hardcover pieces live in `backend/src/modules/books/adapters/hardcover/hardcover.ts`:
- the query text;
- `lookupEditions(isbns, deps)`, which returns parsed editions;
- `featuredSeriesOf(book)`;
- `genresFromTags(cachedTags)`.

The fill loop lives in `backend/src/modules/books/seed/hardcoverFill.ts`. It is `fillFromHardcover(deps, options)`, with the repository, the lookup function, `now` and `log` injected, so tests need no network.

The repository gains:
- `isbnPage(afterRowid, limit)`, which returns `{ rowid, id, isbn, workId, language, hasSummary }` for editions with a non-empty `isbn`, ordered by rowid. `hasSummary` follows Decision 6.
- `hasWorkSeries(workId, source)`.
- `removeWorkSeries(nameKeys, source)`.

Everything else reuses existing methods. An edition with no `work_id` gets only the description step.

### The report

```
{ dryRun, requests, editions, matched, lastRowid, stoppedBy: "done"|"max-requests"|"daily-quota"|"error",
  series:   { added, skipped, works },
  descriptions: { added, descriptionWrongLanguage, alreadyHadSummary },
  genres:   { works, editions, noMappedGenre },
  skippedBooks, duplicateIsbns,
  seriesNames: [{ name, works }]  // most works first; in a real run, the names added
  genreSamples: [{ tags, genres }] // dry run only, the first 50 matched books with Genre tags
}
```

## Running it (runbook entries)

The deploy hold for the pre-2002 BNP import stays in force (until about 21:00Z on 2026-10-25). Nothing runs before the deploy that carries this code. The steps:

1. The user creates a Hardcover API token (scope `read:catalog` is enough; `read:me` is useful for checking it). They set `HARDCOVER_API_TOKEN` on the Railway backend service.
2. After the deploy, the dry run, run over `railway ssh` with `setsid` as the README's series commands are. 500 requests is about 25k editions and one tenth of a day's quota:
   ```
   node scripts/fill-hardcover.mjs --dry-run --max-requests 500 > /data/hardcover-dry.json 2> /data/hardcover-dry.log
   ```
3. The user and Claude review `seriesNames`, `genreSamples` and the language drop. The rejected names go into `/data/hardcover-skip.json`. If the drop shows that Decision 6 would write too few descriptions to be worth it, raise that before step 4.
4. The real run, on a UTC day with the full quota left:
   ```
   node scripts/fill-hardcover.mjs --skip /data/hardcover-skip.json > /data/hardcover.json 2> /data/hardcover.log
   ```
   If it stops with `daily-quota` or is killed by a deploy, re-run it the next day with `--after <lastRowid>`. A deploy kills `railway ssh` jobs, so hold merges during the roughly 90-minute run.
   Then the user and Claude review the run's full `seriesNames`, and run `--remove /data/hardcover-remove.json` for anything rejected.
5. Run the synopsis backlog's free rule pass over the new descriptions, with the Jev key blanked so no paid calls happen: `TYPESAFE_API_KEY= node scripts/synopsis-backlog.mjs --max 1` (`--max` is required, `synopsis-backlog.mjs:4-8`). The Jev pass is the user's call, as before. The daily synopsis sweep already judges new texts on held works.

## Error handling

Covered under The script. Two more rules:
- The fill never deletes anything. Only `--remove` deletes, and only `hardcover` series rows and their search entries.
- A failed page is never marked as done. The cursor only moves past pages whose writes committed, and the report's counters cover committed pages only.

## Testing

Backend, `node:test` via `tsx --test`. New files go into `backend/package.json`'s explicit test list, and they use the env preamble from `awardsFill.test.ts:12-19`.

- **`hardcover.test.ts`:**
  - `featuredSeriesOf`: featured, sole, several unfeatured, none;
  - position formatting;
  - `genresFromTags`: count and share thresholds, the limit, unknown tags dropped, missing `Genre` key;
  - ISBN-10 back-matching;
  - a skipped deleted or deduped book;
  - query variables built from a page.
- **`hardcoverFill.test.ts`**, on in-memory SQLite with `applyBooksMigrations`:
  - a series added under `hardcover`, and a skip-list name not added;
  - a description written into an empty summary with `summary_source = 'hardcover'`;
  - an existing summary kept;
  - an English description dropped on a Portuguese edition;
  - genres filled only on `'[]'` editions;
  - a dry run writes nothing and reports the same counts;
  - `--after` and `--max-requests` cursor behaviour;
  - a daily-quota stop that reports `lastRowid`.
  - an edition whose work has an Open Library work summary is left alone;
  - a French or 978-3 null-language edition gets no English description;
  - a resumed run doesn't add a second `hardcover` series to a work that has one;
  - `--remove` deletes the `hardcover` rows and their `series_fts` entries, but keeps the entry when a `wikidata` row has the same name key;
  - an edition with no `work_id` gets only its description.
- **`http.test.ts`:** `postJson` sends method, body and headers, its 429 carries `retryAt` from `Retry-After`, and it passes its `timeoutMs`.
- **Series rank:** `bestSeriesOf` with a `wikidata` row beating a `hardcover` row, a `hardcover` row beating an `ol-subject` row, and an edition collection supplying a position to a `hardcover` series.
- **Shared:** `summarySource` typing compiles.
- **Checks:** typecheck and lint in backend, shared and frontend, then `node scripts/gate.mjs`.

No device pass: nothing rendered changes, apart from the web summary source label.

## Docs

- `backend/README.md`: a "Hardcover enrichment" section covering the token, the dry run, the review, the real run, resuming, and deleting a wrong series row by hand. It also gives the terms summary, so a later reader knows why ratings and moods aren't stored. The series-order sentence at `backend/README.md:176` gains Hardcover.
- `docs/services.md`: list Hardcover as a source used by an owner-run script.

## Later (not in this design)

- A daily job for newly held works.
- Hardcover ratings ("★ 4.1 on Hardcover") in the Stats screen.
- Mood chips.
- Umbrella series for search.
- Pages and year from Hardcover editions.
