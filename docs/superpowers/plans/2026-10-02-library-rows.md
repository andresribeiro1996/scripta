# Library rows (phase B): implementation plan

> **For agentic workers:** implement task by task, verify each, commit each task separately. Steps use checkbox (`- [ ]`) syntax. Run a spec review and a quality review after each task (`.claude/agents/`).

**Goal:** Every read of someone's library except the owner's own full fetch
uses rows kept in step with the document, so public views, murals and profile
pages stop parsing whole libraries. Clients don't change.

**Spec:** `docs/superpowers/specs/2026-10-01-library-rows-design.md`.

**Base:** `claude/exciting-brown-ccq1ct` after workstreams 1–4 are integrated
(the library routes were restructured into rate-limit scopes there).

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

## Task 1: Boot never loads every library at once

**Files:** `backend/src/modules/library/migration.ts`, its test.

`readEmbeddedMurals` runs on every boot and loads every library document into
memory with `.all()`, then parses each, though the murals migration finished
long ago. Production has about 1 GB of memory: a few hundred MB of libraries
would crash every deploy at boot.

- [ ] Select only documents that still contain the key
  (`WHERE instr(data, '"murals"') > 0`) and walk them with `.iterate()`
  instead of `.all()`.
- [ ] `backfillLibraryDerived` already handles one document at a time; keep it
  that way in Task 3.
- [ ] Test: a document without `murals` is never parsed (only matching rows
  are returned), and the migration result is unchanged for one that has it.

## Task 2: Capture today's outputs first

**Files:** new `backend/src/modules/library/publicViews.test.ts` (add to the
test list).

Before any read changes, pin what the public reads return today, so Task 4 can
prove nothing changed.

- [ ] Fixtures that cover: duplicate books with the same `bookKey` (the last
  one wins in today's `byKey` map), books missing title/author/ISBN, a manual
  `_coverUrl`, a cover only in the covers cache (`peekCachedCoverUrl`),
  collections and series in `groups`, highlights and reader notes, every
  `ReadStatus`, `DateLastRead` in this year and another.
- [ ] For each fixture, assert the current outputs of
  `getPublicByToken` (shared library), `resolvePublicLibrary` (profile
  library) and `resolvePublicLibraryData` (murals and profile shelf mural, with
  book refs, a collection, highlight refs, currently-reading, every stats
  metric, shelf theme and reader card requested). These assertions must pass
  unchanged after Task 4.

## Task 3: Rows kept in step with the document

**Files:** `backend/src/modules/library/adapters/sqlite/{schema.sql,connection.ts,sqliteLibraryRepository.ts}`,
`backend/src/modules/library/domain/{constants.ts,types.ts,ports.ts}`,
`backend/src/modules/library/service.ts`, `migration.ts`, tests.

- [ ] Tables (spec's model, with one simplification: groups stay JSON in the
  summary in this phase, since they are small and always read whole):
  - `library_books (user_id, position, book_key, title, author, isbn,
    image_id, read_status, percent_read, rating, date_last_read,
    finished_year, series_number, sort_order, cover_url, cover_image_id,
    genres, highlight_count, row_hash, PRIMARY KEY (user_id, position))`,
    indexes `(user_id, book_key)` and `(user_id, read_status)`.
    `book_key` uses the same `bookKey` the public resolver uses today.
    `finished_year` is computed exactly like today's `finishedInYear` does
    (`new Date(DateLastRead).getFullYear()` for finished books).
  - `library_highlights (user_id, position, highlight_id, text, annotation,
    type, created_at, PRIMARY KEY (user_id, position, highlight_id))`.
  - `library_derived` (kept, it becomes the spec's summary) gains `meta`
    (JSON: `source`, `schema_version`, `book_count`, `name`, `groups`,
    `style`), `reader_card`, `shelf_theme`, and the counts `book_count`,
    `finished_count`, `in_progress_count`, `highlight_count`.
- [ ] `deriveLibraryRows(data)` in `service.ts`, next to `deriveLibraryData`:
  pure, returns the rows and the summary, with each book's `row_hash` taken
  from its JSON text.
- [ ] `writeDerived` (same transaction as the document, every write path) only
  rewrites books whose `(position, row_hash)` changed, deletes positions that
  no longer exist, rewrites highlights only for changed books, and replaces
  the summary.
- [ ] `LIBRARY_DERIVED_VERSION` 1 → 2 and the gate in `connection.ts` becomes
  `storedVersion !== derivedVersion` (a rolled-back build rebuilds too); the
  tables it drops include the new ones, so the startup step rebuilds every
  account. Log how long that startup step took.
- [ ] `deleteUserData` clears the new tables.
- [ ] Tests: rows match the document after a save, an edit of one book (only
  that row rewritten, verified by its rowid or a write counter), a reorder, a
  deletion and a merge; deleting the account clears everything.

## Task 4: Reads use rows

**Files:** `backend/src/modules/library/{publicResolver.ts,service.ts,routes.ts}`,
`backend/src/modules/books/publicCoverLookup.ts` (and `books/index.ts`),
tests.

- [ ] Books module: `peekCachedCoverUrls(params[])` resolves many cover
  lookups in one query (keys through `json_each`), returning the same URLs
  `peekCachedCoverUrl` returns one by one. Test that both agree.
- [ ] `getPublicByToken` and `resolvePublicLibrary` build the public document
  from `library_derived.meta`, then `library_books` in `position` order with
  the public columns only, covers from `cover_url` or the batch lookup.
- [ ] `resolvePublicLibraryData`: referenced books by `book_key` (the highest
  position wins, matching today's last-wins map), collections from
  `meta.groups`, highlights by `(position, highlight_id)`, currently-reading by
  `read_status = 1`, stats from the summary counts and `finished_year`, shelf
  theme and reader card from the summary.
- [ ] Delete `parseLibraryDocument` and anything else left unused.
- [ ] `GET /library` sends the stored JSON text inside the response without
  parsing it (`reply.type("application/json").send(...)` with
  `data`, `updatedAt`, `shareToken`, `shareUrl`); `PUT /library` and
  `POST /library/books/merge` echo the JSON text they just stored.
- [ ] Task 2's assertions pass unchanged; the existing route tests pass.

## Done when

- All tasks committed; build, typecheck and backend tests pass.
- Report, from a throwaway script (not committed): time of
  `GET /community/profiles/:username/library` on a 10 MiB fixture before
  (Task 2's base) and after Task 4.
- Report the startup rebuild time for that fixture.
