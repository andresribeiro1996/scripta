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
(`migration.ts:37`, c2a797d6), so it needs no task here.

## Definitions (every task uses these)

- **Position** is the raw index in `data.books`. An entry that isn't an
  object (`isRecord` from shared; arrays count as objects, as there) gets no
  row; its index is skipped, not renumbered. Full rebuilds, whole saves and
  small saves all use this, so their positions agree.
- **`book_key`** comes from shared `bookKey`. Task 4 deletes the identical copy
  in `publicResolver.ts:115`.
- **`row_hash`** comes from one helper, `bookRowHash(book)`: a hash of
  `JSON.stringify(book)`. Every write path uses it.
- **Typed columns keep today's checks.** The public projections test every
  field (`publicResolver.ts:189-243`).
  - A column holds a value only when it passes the same `typeof` check the
    projection makes, else NULL. On read, NULL is an absent key for the
    shared and profile library, and whatever today's projection gives for a
    missing field in murals (`null`, "Untitled", "Unknown author").
  - `isbn` and `image_id` are stored raw (strings only). The library routes
    return them raw. Murals apply `normalizeIsbn` and `normalizeImageId` on
    read, as today.
  - `cover_url` is stored only when it is a string, `""` included, as today.
  - `read_status`, `series_number` and `sort_order` are REAL. An integral
    value past 2^53 in an INTEGER column can't be read without `readBigInts`,
    and every public view of that account would return 500. A string such as
    `"2"` is NULL, never converted.
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

## Task 2: Rows kept in step with the document

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
    type, created_at, PRIMARY KEY (user_id, position, highlight_id))`.
    - `highlight_id = String(BookmarkID)`, so a missing id is `"undefined"`,
      matching `publicResolver.ts:394`.
    - Insert with `INSERT OR IGNORE`, so the first of a duplicate id wins,
      as `find` does.
    - Non-object highlights get no row.
    - Store only the fields the mural quote block reads; check
      `publicResolver.ts` for the list.
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
- [ ] **`deriveLibraryRows(data)`** in `service.ts`, next to
  `deriveLibraryData`. It is pure, and returns the book rows, highlight rows
  and summary under the definitions above.
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
      positions, built by the same row helper and `bookRowHash`.
    - Highlights are untouched.
  - **Membership change:** no book rows change; `meta.groups` is replaced.
  - **Summary:**
    - Recount `finished_count` and `in_progress_count` from the parsed
      books, in one loop with no stringify.
    - Recompute `reader_card` on exactly the glyph's rule (both use
      `readerIdentity`: a status to or from Finished, or a tick in a series
      group); otherwise keep it.
    - Keep `shelf_theme`, which reads only genres, and no membership or book
      change alters them.
  - **Measure** a book change and a membership change on the fixture below,
    before and after, and put both in the commit message. The goal is no
    more than about 10 ms added to 2a's 140–200 ms.
- [ ] **Stale check.** The startup step (`backfillLibraryDerived` and its
  `listStaleUserIds`) also treats an account as stale when its
  `library_summary` row is missing or its `source_updated_at` differs from
  `library_documents.updated_at`.
  - It rebuilds that account's rows one document at a time, as now.
  - On first boot that is every account. Log the count and the time taken.
  - An unreadable document gets a summary with NULL `meta` and no book rows.
- [ ] **Deletion:**
  - `deleteUserData` clears the three new tables.
  - `deleteOrphanedDerived` also clears them for users with no document. An
    account deleted while a rolled-back build ran would otherwise keep its
    books and highlight text forever.
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
  - After each kind of small save, the rows equal `deriveLibraryRows` of the
    stored document. The kinds are a tick in a series group, a tick in a
    collection, a status to and from Finished, a rating, and an add.
  - A small save on an account whose rows were stale leaves them stale, and
    the startup step then rebuilds them.
  - A startup run straight after a change rebuilds nothing.
  - A document written without touching the new tables (as a rolled-back
    build would) is rebuilt by the next startup.
  - Deletion and orphan cleanup clear everything.

## Task 3: Public reads use rows

**Files:** `backend/src/modules/library/{publicResolver.ts,service.ts}`,
`backend/src/modules/books/publicCoverLookup.ts` (and `books/index.ts`),
tests. Callers to re-check: murals, the community profile, quizzes
(`quizzes/routes.ts:117`) and tierlists (`tierlists/routes.ts:87,146,245`).

- [ ] **Look up the owner without reading the document.**
  - By share token: select `user_id`, `share_token` and `updated_at` only.
    Today's `getByShareTokenStmt` is `SELECT *`.
  - By user: check `library_summary`. Today `getDocumentStmt` selects
    `data`.
  - A missing summary, or a NULL `meta`, gives exactly today's answer for an
    unparseable document: a 404 or the empty result
    (`service.ts:337-342`, `publicResolver.ts:330`).
- [ ] **Books module: `peekCachedCoverUrls(params[])`.**
  - It resolves many lookups in one query, keys through `json_each`.
  - It keeps `findByIdentity`'s two-step order: the ISBN key first, then
    `titleKey`. A book with neither gets null, as `lookupIdentity` gives.
  - Test that it agrees with `peekCachedCoverUrl` called one by one.
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

- [ ] Add a separate method that returns the stored text. Leave
  `getLibrary` and `saveLibrary` alone: the 409 `current` body
  (`routes.ts:160,198`) and unshare (`routes.ts:219`) use them, and returning
  text there would put a JSON string inside JSON for installed clients.
- [ ] `GET /library`, the `PUT /library` echo and the `POST
  /library/books/merge` echo send `{"data":<stored text>,…}`, built as a
  string, with `Content-Type: application/json; charset=utf-8`.
  - Stored text is only ever written by `JSON.stringify` on the server, so
    it is valid JSON. A document the summary marks unreadable (NULL `meta`)
    still gets today's 500.
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
