# Library rows (phase B): implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax. Run a spec review and a quality review after each task (`.claude/agents/`).

**Goal:** Every read of someone's library except the owner's own full fetch
uses rows kept in step with the document, so public views, murals and profile
pages stop parsing whole libraries. Clients don't change.

**Spec:** `docs/superpowers/specs/2026-10-01-library-rows-design.md`.

**Base:** `main` after small saves PR 1 (#111): the library routes are in
rate-limit scopes, and `applyChange` writes a change through
`updateDocumentData` without re-deriving the whole document.

**Rules:** root `AGENTS.md`, `backend/AGENTS.md`. No code comments. Response
shapes of every route below stay byte-for-byte the same JSON values (key order
may differ only where it already can). New `*.test.ts` files go into
`backend/package.json`'s `test` list. Verify with:

```
npm run build --workspace @scripta/shared
npm run typecheck --workspace backend
npm test --workspace backend
```

---

The boot murals scan already streams only documents that still hold murals
(`migration.ts:39`, c2a797d6), so it needs no task here.

## Definitions (every task uses these)

- **Position** is the raw index in `data.books`. An entry that isn't an
  object (the backend's `isRecord`, `service.ts:24`; arrays count as objects)
  gets no row; its index is skipped, not renumbered. Full rebuilds, whole saves and
  small saves all use this, so their positions agree.
- **`book_key`** comes from shared `bookKey`. Task 3 deletes the identical copy
  in `publicResolver.ts:115`.
- **The normalised ISBN** is `book_key.startsWith("isbn:") ? book_key.slice(5)
  : null`. Shared `bookKey` and `normalizeIsbn` match the resolver's copies
  byte for byte. Murals' `isbn` and both routes' cover-lookup ISBN use it,
  so a numeric `ISBN` still works as it does today. The raw `isbn` column
  only feeds the library route's `ISBN` field.
- **`row_hash`** comes from one helper, `bookRowHash(book)`: a hash of
  `JSON.stringify(book)`. Every write path uses it.
- **Typed columns keep today's checks.** The public projections test every
  field (`publicResolver.ts:189-243`).
  - A column holds a value only when it passes the same `typeof` check the
    projection makes, else NULL. On read, NULL is an absent key for the
    shared and profile library, and whatever today's projection gives for a
    missing field in murals (`null`, "Untitled", "Unknown author").
    `_coverUrl` is the exception: the library routes always emit it, as
    `null` when there is no cover (`publicResolver.ts:241`).
  - `isbn` and `image_id` are stored raw (strings only). The library routes
    return them raw. Murals take the ISBN from `book_key` (above), and apply
    `normalizeImageId` on read, as today.
  - `cover_url` is stored only when it is a string, `""` included, as today.
  - `read_status`, `series_number` and `sort_order` are REAL. An integral
    value past 2^53 in an INTEGER column can't be read without `readBigInts`,
    and every public view of that account would return 500. A string such as
    `"2"` is NULL, never converted.
- **Unreadable** means the stored text doesn't parse, or `libraryParts` of it
  is null. Such a document gets a summary with NULL `meta`, and its book and
  highlight rows are deleted. Reads treat a NULL `meta` as today's parse
  failure: the shared link 404s, the profile library is null, and murals
  are empty. Today a document whose JSON isn't an object, or that has no
  `books` array, gives slightly different answers per route. `PUT /library`
  can't write either, so only legacy rows could hit them; the NULL-`meta`
  answer replaces them, and that is accepted.
- **Odd fields never fail a write or boot.** `String()` throws on a client
  value like `{"toString":5}` (commit 4a614448 added `textFields` to stop
  exactly that in saves; see the "backfill-odd" document at
  `service.test.ts:739`). Rows are computed inside the save transaction and
  before `listen`, so a throw would fail every save for that account and
  crash-loop boot. So:
  - A book whose `bookKey` throws gets no book row and no highlight rows. A
    highlight whose `String(BookmarkID)` throws gets no row. Log each once,
    with the user id and position.
  - If the reader card throws, store `reader_card` as NULL and log it. A
    mural that asks for the reader card then fails with a 500, as it does
    today for that document.
  - Catch only `TypeError` from these calls; anything else propagates.
  - Today such a document already gives a 500 on the public reads that hit
    the bad field. Serving it without the bad book is the accepted
    difference, and Task 1's golden fixtures leave these documents out.
- **Columns are only what a phase-B read needs.** If a projection reads a
  field this plan doesn't list, add it under the same rules and say so in the
  commit. Don't add others: every column is private data in a table the
  public queries read.

## Task 1: Capture today's outputs first

**Files:** new `backend/src/modules/library/publicViews.test.ts` (add it to
the test list).

Before any read changes, pin what the public reads return today, so Task 3 can
prove nothing changed.

- [ ] Write fixtures through `saveLibrary` (never raw inserts into
  `library_documents`), so they keep working once reads need derived rows.
- [ ] The fixtures cover:
  - duplicate books with the same `bookKey` (today's `byKey` map keeps the
    last);
  - books missing title, author or ISBN;
  - non-string `Title`/`ISBN`/`ImageId`, and a string `ReadStatus`/`_order`;
  - a non-object entry in `books`;
  - a manual `_coverUrl`, and an empty `""` one;
  - a cover only in the covers cache (`peekCachedCoverUrl`), found by ISBN,
    and one found by title only;
  - collections and series in `groups`, including a collection holding a key
    no book has;
  - highlights and reader notes, two highlights sharing a `BookmarkID`, one
    with no `BookmarkID`, and a non-object highlight;
  - every `ReadStatus`, and `DateLastRead` in this year and another.
- [ ] For each fixture, assert today's outputs of:
  - `getPublicByToken` (shared library);
  - `resolvePublicLibrary` (profile library);
  - `resolvePublicLibraryData` (murals and the profile shelf mural), with
    book refs in a non-sorted order, a collection, repeated highlight refs,
    currently-reading, every stats metric, shelf theme and reader card
    requested.

  These assertions must pass unchanged after Task 3.
- [ ] Also pin `GET /library`'s body and `Content-Type`
  (`application/json; charset=utf-8`), and a 409 from `PUT /library` with
  its `current` body.

## Task 2a: Rows kept in step with the document

**Files:** `backend/src/modules/library/adapters/sqlite/{schema.sql,sqliteLibraryRepository.ts}`,
`backend/src/modules/library/domain/{types.ts,ports.ts}`,
`backend/src/modules/library/service.ts`, `migration.ts`, tests.

**New tables only.** `library_derived` and `library_match_keys` stay exactly
as they are, and so does `LIBRARY_DERIVED_VERSION` and its gate. A rollback
to today's main then works: that build ignores the new tables. Its saves
leave them stale, and the stale check below rebuilds them on roll-forward.

- [ ] **Tables:**
  - `library_books (user_id, position, book_key, title, author, isbn,
    image_id, read_status REAL, series_number REAL, sort_order REAL,
    cover_url, finished_year INTEGER, row_hash, PRIMARY KEY (user_id,
    position))`, with indexes `(user_id, book_key)` and `(user_id,
    read_status)`.
    - `finished_year` is computed exactly like today's `finishedInYear`.
  - `library_highlights (user_id, position, highlight_id, text, annotation,
    PRIMARY KEY (user_id, position, highlight_id))`. The mural quote block
    reads only `Text` and `Annotation` (`publicResolver.ts:399-400`).
    - `highlight_id = String(BookmarkID)`, so a missing id is `"undefined"`,
      matching `publicResolver.ts:394`.
    - Insert with `INSERT OR IGNORE`, so the first of a duplicate id wins,
      as `find` does.
    - Non-object highlights get no row.
  - `library_summary (user_id PRIMARY KEY, meta, reader_card, shelf_theme,
    total_books, finished_count, in_progress_count, total_highlights,
    source_updated_at NOT NULL)`.
    - `meta` is JSON: the document's own fields that the public views pass
      through (`source`, `schema_version`, its `book_count`, `name`,
      `groups`, `style`). `meta` is NULL when the stored document is
      unreadable.
    - `total_books` counts object books.
    - `total_highlights` sums raw `highlights.length`, non-objects included
      (`publicResolver.ts:146`).
    - These names don't clash with the document's own `book_count` inside
      `meta`.
- [ ] **`bookRow(book, position)`**, which builds one book row and its highlight
  rows under the definitions above, and **`libraryMeta(data)`**, which builds
  `meta`. Export both from `service.ts`. Every write path, Task 2b included,
  uses them, so the typed-column rules live in one place.
- [ ] **`deriveLibraryRows(data)`** in `service.ts`, next to
  `deriveLibraryData`, built from `bookRow` and `libraryMeta`. It is pure, and returns the book rows, highlight rows
  and summary under the definitions above. Its `reader_card` is
  `publicReaderCard(readerIdentity(libraryParts(raw).allBooks,
  toReaderGroups(groupRecords)))` on the raw books, as `publicResolver.ts:425`
  computes it today, and its `shelf_theme` is `calculateShelfTheme` on the
  same books.
- [ ] **`writeRows`** runs in the same transaction as the document, on every
  whole-document write path: `saveLibrary`, `addBook`, `mergeBooks`, and
  `applyChange` for an add (which goes through `upsertDocument`).
  - It rewrites only books whose `(position, row_hash)` changed, and deletes
    rows at positions that are now past the end or not objects.
  - It rewrites highlights only for changed positions.
  - It upserts the summary with `source_updated_at` set to the new document
    version.
  - An unchanged save writes no book or highlight rows. Test it with
    `total_changes()` or a write counter, not rowids, because an UPDATE keeps
    the rowid.
- [ ] **Stale check.** Today `listStaleStmt` joins only `library_derived`, and
  `backfillLibraryDerived` only calls `setDerived`. Extend both:
  - An account is stale when its `library_derived` is stale (as now), or when
    its `library_summary` row is missing or its `source_updated_at` differs
    from `library_documents.updated_at`.
  - For each stale account the loop writes `library_derived` (as now) and
    the rows and summary through `writeRows`, one document at a time.
  - On first boot that is every account. Log the count and the time taken.
  - An unreadable document gets a summary with NULL `meta`, and its existing
    book and highlight rows are deleted.
- [ ] **Deletion:**
  - `deleteUserData` clears the three new tables.
  - `deleteOrphanedDerived` also clears them for users with no document. Check
    each new table against `library_documents` directly, not through
    `library_derived`, which may be gone or already cleared. An account
    deleted while a rolled-back build ran would otherwise keep its books and
    highlight text forever.
- [ ] **Fixture:** the timing fixture is built by a test helper. It holds
  5,000 books with 50,000 highlights, padded with long titles to about
  10 MiB. Don't commit generated data.
- [ ] **Tests:**
  - After a save, an edit of one book, a reorder, a deletion and a merge,
    the rows match `deriveLibraryRows` of the stored document. Only the
    edited row is written.
  - Duplicate and missing `BookmarkID`s don't fail a save.
  - Typed columns follow the rules above: a string `"2"` status is NULL, and
    an `_order` of 2^60 reads back.
  - A document written without touching the new tables (as a rolled-back
    build would) is rebuilt by the next startup. Bring
    `library_derived.source_updated_at` up to the document's `updated_at`
    first (with `repo.setDerived` or a raw UPDATE), so that only the summary
    is stale. That is what a rolled-back build leaves; without that step,
    today's check alone would pass the test.
  - An unreadable document's rebuild leaves NULL `meta` and no rows.
  - Deletion and orphan cleanup clear everything, including when
    `library_derived` has no row for that user.
  - Documents whose fields throw save, and boot rebuilds them, without
    throwing. A book with no ISBN and an object `Attribution` (so `bookKey`
    throws) gets no row. A highlight with an object `BookmarkID` gets no
    row. Ten finished books plus an odd one make the reader card throw, so
    `reader_card` is NULL. ("backfill-odd" at `service.test.ts:739` has a
    valid ISBN and one book, so it hits neither path.)

## Task 2b: Small saves keep the rows in step

**Files:** `backend/src/modules/library/{service.ts,adapters/sqlite/sqliteLibraryRepository.ts,domain/ports.ts}`,
tests.

- [ ] **`updateDocumentData`'s new signature:**
  `updateDocumentData(userId, json, expectedUpdatedAt, glyph | "keep",
  rows: { books: BookRow[]; counts: { finished: number; inProgress: number };
  meta: string | "keep"; readerCard: string | "keep" })`. The other summary
  fields stay as stored.
- [ ] **Small saves keep the rows in step.** `applyChange` writes a
  membership or book change through `updateDocumentData`. After the
  document UPDATE, in the same transaction:
  1. `UPDATE library_summary SET … , source_updated_at = $new WHERE user_id
     = ? AND source_updated_at = $expected`.
  2. Only if that changed one row, write the changed book rows. If it didn't,
     the rows were already stale. Leave everything for the stale check.
  - **Book change** (status, rating):
    - The changed positions are the entries whose object identity differs
      between the previous and new `books` (`applyLibraryChange` returns the
      same objects for the rest). Finding them needs no hashing or `bookKey`
      scan.
    - `applyChange` passes the repository full row values for those
      positions, built by `bookRow`.
    - Highlights are untouched.
  - **Membership change:** no book rows change; `meta` is rebuilt with
    `libraryMeta`.
  - **Summary:**
    - Recount `finished_count` and `in_progress_count` from the parsed
      books, in one loop with no stringify.
    - Recompute `reader_card` on exactly the glyph's rule (a status to or
      from Finished, or a tick in a series group); otherwise keep it.
      Compute it as `publicResolver.ts:425` does today:
      `publicReaderCard(readerIdentity(libraryParts(raw).allBooks,
      toReaderGroups(groupRecords)))`, on the raw books. Never reuse the
      glyph's identity, which runs on `textFields` copies: a numeric `Title`
      becomes `undefined` there, so the dedupe and counts differ.
    - Keep `shelf_theme`, which reads only genres, and no membership or book
      change alters them.
  - **Measure** a book change and a membership change on Task 2a's fixture,
    before and after, and put both in the commit message. The goal is no
    more than about 10 ms added to the 140–200 ms that small saves measured
    (a6ab168).
- [ ] **Tests:**
  - After each kind of small save, the rows equal `deriveLibraryRows` of the
    stored document. The kinds are a tick in a series group, a tick in a
    collection, a status to and from Finished, a rating, and an add.
  - A book change rewrites only that book's row.
  - A small save on an account whose summary was stale leaves it stale, and
    the startup step then rebuilds it. As in 2a, bring
    `library_derived.source_updated_at` current first, so that only the
    summary is stale.
  - A startup run straight after a change rebuilds nothing.

## Task 3: Public reads use rows

**Files:** `backend/src/modules/library/{publicResolver.ts,service.ts}`,
`backend/src/modules/books/publicCoverLookup.ts` (and `books/index.ts`),
tests. Callers to re-check: murals, the community profile, quizzes
(`quizzes/routes.ts:117`) and tierlists (`tierlists/routes.ts:87,146,245`).

- [ ] **Look up the owner without reading the document.**
  - By share token: select `user_id` and `share_token` only. Today's
    `getByShareTokenStmt` is `SELECT *`. Serve the rows even if the summary
    is older than the document: that only happens across a rollback, and
    the next boot fixes it. Never fall back to parsing the document.
  - By user: check `library_summary`. Today `getDocumentStmt` selects
    `data`.
  - A missing summary, or a NULL `meta`, gives exactly today's answer for an
    unparseable document: a 404 or the empty result
    (`service.ts:337-342`, `publicResolver.ts:330`).
- [ ] **Books module: `peekCachedCoverUrls(params[])`.**
  - It resolves many lookups in one query, keys through `json_each`.
  - It keeps `findByIdentity`'s exact rule (`books/domain/normalize.ts:69-70`).
    It uses the title key only when no book row exists for the ISBN key. An
    ISBN row with no cover gives null, even when a title row has one. Don't
    write it as a `COALESCE` of the two covers. A book with neither key gets
    null, as `lookupIdentity` gives.
  - Test that it agrees with `peekCachedCoverUrl` called one by one. Include
    an ISBN row with no cover next to a title row that has one.
- [ ] **One builder** serves both the shared library and the profile library,
  replacing `service.getPublicByToken`'s and
  `publicResolver.resolvePublicLibrary`'s two paths.
  - It builds the public document from `meta`, then `library_books` in
    `position` order, public columns only.
  - Covers come from `cover_url`, or from the batch lookup for the rest.
- [ ] **`resolvePublicLibraryData`** reads rows under today's exact rules:
  - **Referenced books:** look up by `book_key`; the highest position wins.
    Output follows request order: `new Set([...bookKeys, ...collection
    keys])`.
  - **Collections:** from `meta.groups`, keeping only keys some book row has.
  - **Highlights:** look up by `(position, highlight_id)`. Keep the request
    order, and keep repeated refs.
  - **Currently reading:** `read_status = 1 ORDER BY position`, duplicates
    kept.
  - **Stats:** from the summary's counts and `finished_year`.
  - **Shelf theme and reader card:** from the summary.
- [ ] Delete `parseLibraryDocument`, the duplicate `bookKey`, and anything
  else left unused.
- [ ] **Tests:**
  - Task 1's assertions pass unchanged.
  - Existing tests that insert into `library_documents` directly
    (`murals/home.test.ts:46,101,134`, parts of `service.test.ts`) may switch
    their setup to `saveLibrary`, or call the startup step after the insert.
    Their assertions stay as they are.
  - A public library view of the fixture never calls `JSON.parse` on the
    document (spy), and finishes under a fixed budget. Set the budget at
    about 3× what you measure, and put the measurement in the commit.

## Task 4: The owner's own fetch skips the re-serialise

**Files:** `backend/src/modules/library/{service.ts,routes.ts}`, tests.

- [ ] Leave `getLibrary` alone: the 409 `current` body (`routes.ts:160,198`)
  and unshare (`routes.ts:219`) use it, and returning text there would put a
  JSON string inside JSON for installed clients.
- [ ] Add `getLibraryText(userId)`, which returns the stored text plus
  `updatedAt`, `shareToken` and `shareUrl`. Change `saveLibrary` and
  `mergeBooks`, the no-op path at `service.ts:276` included, to return that
  same shape with the text they just wrote, instead of `toLibraryDocument`,
  which parses it again. Update their other callers.
- [ ] `GET /library`, the `PUT /library` echo and the `POST
  /library/books/merge` echo send the body built as a string, keys in this
  order: `{"data":<stored text>,"updatedAt":…,"shareToken":…,"shareUrl":…}`.
  The values are `JSON.stringify`'d and the header is `Content-Type:
  application/json; charset=utf-8`.
  - Stored text is only ever written by `JSON.stringify` on the server, so it
    is valid JSON. `getLibraryText` doesn't read `library_summary`. Today an
    unparseable stored document gives `GET /library` a 500; it would now
    send that text as is. Only a hand-edited database could hold one, and
    that difference is accepted.
- [ ] Task 1's `GET /library` and 409 assertions pass unchanged.

## Done when

- Every task is committed, and build, typecheck and backend tests pass.
- From a throwaway script (not committed), report the time of
  `GET /community/profiles/:username/library` on the fixture, before Task 1's
  base and after Task 3.
- Report the startup rebuild time for the fixture.
- Run the `security-review` skill before the PR: this touches share links
  and who can see what.

## Deploy notes

- There are no new env vars, `*_DB_PATH` or Railway settings.
- The first boot builds rows for every account before `listen`.
  Production's largest library is 67 KB, so this is quick. Check its log
  line after deploy.
- A rollback to pre-rows main is safe. On roll-forward, the stale check
  rebuilds every account saved in between. Orphan cleanup clears accounts
  deleted in between.
