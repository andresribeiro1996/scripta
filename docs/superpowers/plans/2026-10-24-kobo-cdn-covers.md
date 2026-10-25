# Kobo CDN Covers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog books learn the Kobo `ImageId` that Kobo imports already carry, and the cover lookup tries Kobo's own CDN first for them; libraries imported before this get the same through a daily backfill.

**Architecture:** Books module only for the lookup (a `books.kobo_image_id` column, a `kobo` step at the head of `findBestCover`, recording in `enqueueCovers` and a new `recordKoboImageIds`). The library module exposes one read (`koboCoverLookups`) that `app.ts` injects into the books plugin, as it already injects `heldWorks`. No route or client changes.

**Tech Stack:** TypeScript, Fastify, `node:sqlite`, `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-24-kobo-cdn-covers-design.md`

## Global Constraints

- `koboCoverUrl(id)` returns exactly `https://cdn.kobo.com/book-images/${encodeURIComponent(id)}/1200/1800/False/image.jpg` (capital `False`, as the viewer's working URL).
- An id is used only if `normalizeImageId` from `@scripta/shared` returns it non-empty. Use that function; don't write another UUID check.
- `books.kobo_image_id` is written only when it is NULL. Nothing ever overwrites or clears it.
- "Wants a Kobo upgrade" means: status `missing` or `low_res`, or status `good` with the current image's `source` `isbndb` and `isPortugueseIsbn(book.isbn)`. Nothing else qualifies (`manual`, other `good`, NULL status).
- `recordKoboImageIds` never creates a catalog row and never schedules the normal lane.
- `enqueueCovers` keeps today's due-book scheduling on the normal lane unchanged.
- `lookupSchema` in `routes.ts` is not changed.
- No comments in code. Prefer adding tests to the existing test files listed below; a new `*.test.ts` must go into `backend/package.json`'s `test` script.
- Verify each task with `node scripts/gate.mjs` before committing (shared build, backend typecheck and tests).

## Baseline

On this container (Node v22.22.0) the backend suite already fails before any change, while CI on main (Node 26) is green:

- `src/booksWiring.test.ts:62` ("every books job arms its first run…") fails: the boot `cover-enqueue` job, which has no first-run delay, looks up the book test 2 seeded and requests `covers.openlibrary.org`.
- `src/modules/books/seed/siteFetch.test.ts:71` is cancelled in the full run and passes alone.

A gate run where only these two fail is a pass. Don't change code to fix them; Task 2 still edits the first one's expectations as listed, and it must pass apart from that pre-existing Open Library request.

## Review Focus

- **No quota spent by the backfill.** `recordKoboImageIds` on a due book records the id and enqueues nothing but `upgrade`; on a lookup with no catalog book it creates nothing.
- **First id wins.** A second, different id for the same book leaves the first.
- **Good and manual covers untouched**, except a Portuguese ISBNdb `good` cover, which is marked for upgrade.
- **Kobo first, exact.** A Kobo candidate of 400 px or more ends `findBestCover` before any other source is asked, a title mismatch doesn't block it, and a rejected Kobo URL is skipped.
- **Apple's stamp.** An upgrade-lane lookup that Kobo answers at 400 px or more asks Apple nothing and leaves `apple_checked_at` NULL.
- **Junk ids ignored.** A sideloaded file path in `ImageId` records nothing (Task 1 in books, Task 2 in `koboCoverLookups`).

---

### Task 1: Kobo cover step and id recording in the books module

**Files:**
- Modify: `backend/src/modules/books/adapters/sqlite/books.sql`
- Modify: `backend/src/modules/books/adapters/sqlite/connection.ts`
- Modify: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.ts`
- Modify: `backend/src/modules/books/domain/types.ts`
- Modify: `backend/src/modules/books/domain/ports.ts`
- Modify: `backend/src/modules/books/domain/normalize.ts`
- Create: `backend/src/modules/books/adapters/sources/kobo.ts`
- Modify: `backend/src/modules/books/coverResolver.ts`
- Modify: `backend/src/modules/books/booksService.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/README.md`
- Test: `backend/src/modules/books/adapters/sources/sources.test.ts`
- Test: `backend/src/modules/books/coverResolver.test.ts`
- Test: `backend/src/modules/books/booksService.test.ts`
- Test: `backend/src/modules/books/adapters/sqlite/sqliteBooksRepository.test.ts`

- [ ] **Schema.** Add `kobo_image_id TEXT` to the `books` table in `books.sql`, and in `applyBooksMigrations` add it to an existing database with the same `columns.some(...)` / `ALTER TABLE books ADD COLUMN` pattern as `apple_checked_at` (`connection.ts:36`). Add `kobo_image_id: string | null` to `BookRow` in `domain/types.ts`. Repository test: an old database (drop the column, as `sqliteBooksRepository.test.ts:1036` does for another column) gets it back on `applyBooksMigrations`.
- [ ] **Repository.** Add `setKoboImageId(bookId: string, imageId: string): boolean` to `BooksRepository` (`domain/ports.ts`) and the SQLite repository: `UPDATE books SET kobo_image_id = ? WHERE id = ? AND kobo_image_id IS NULL`, returning whether a row changed. Test: it sets a NULL column and returns `true`; a second call with another id returns `false` and leaves the first.
- [ ] **Types.** `CoverSourceName` (`types.ts:5`) gains `"kobo"`; `CoverCandidate.source` (`ports.ts:143`) is derived from it and needs no edit. `BookLookup` (`normalize.ts:40-44`) gains `imageId?: string | null`.
- [ ] **URL.** Create `adapters/sources/kobo.ts` exporting `koboCoverUrl(imageId: string): string` per the Global Constraints. Test it in `sources.test.ts`.
- [ ] **Resolver.** `findBestCover`'s first parameter becomes `{ isbn; title; author; koboImageId?: string | null }`. When `koboImageId` is set, push a first step returning `[{ source: "kobo", url: koboCoverUrl(koboImageId) }]` ahead of the ISBN steps. Tests in `coverResolver.test.ts` (use its `source`/`images`/`sources` helpers):
  - a ≥400 px Kobo image is returned and no source's `byIsbn`/`byTitle` is called;
  - the same holds when the book's title matches nothing the sources would accept;
  - a Kobo image under 400 px is kept as best while the other sources are still asked, and a wider one wins;
  - a Kobo URL in `rejected` is skipped;
  - no `koboImageId` means no Kobo candidate.
- [ ] **processBook.** Pass `koboImageId: book.kobo_image_id` to `findBestCover`. Change the `setAppleChecked` condition (`booksService.ts:366`) so it also requires `!(outcome.found?.candidate.source === "kobo" && outcome.found.image.width >= MIN_GOOD_WIDTH)`. Test in `booksService.test.ts` with `harness()`, on the `upgrade` lane: a book with an id and a `sizes` entry of 900×1400 for its Kobo URL, and an Apple source that records calls, ends `good` with `cover_images.source` `kobo`, zero Apple calls, and `apple_checked_at` NULL.
- [ ] **Recording.** In `createBooksService`:
  - `koboUpgradeWanted(book)` implements the Global Constraints rule (current image via `deps.repo.getImage(book.cover_image_id)`).
  - `recordKoboId(book, lookup): boolean` returns `normalizeImageId(lookup.imageId) !== "" && deps.repo.setKoboImageId(book.id, thatId)`.
  - `markKoboUpgrade(book)` calls `deps.repo.setUpgradeWanted(book.id, now().toISOString())` and `schedule(book.id, "upgrade")`.
  - `enqueueCovers`: for each lookup, `findOrCreateBook`; `const recorded = recordKoboId(book, lookup)`; if `lookupDue(book)` schedule normal as today, else if `recorded && koboUpgradeWanted(book)` call `markKoboUpgrade(book)`.
  - New `recordKoboImageIds(lookups: BookLookup[]): void` on the `BooksService` interface: inside one `deps.repo.transaction`, for each lookup take `lookupIdentity(lookup)` and `findExisting(deps.repo, identity)` (`domain/findOrCreate.ts:11`), skip when none, then `if (recordKoboId(book, lookup) && koboUpgradeWanted(book)) markKoboUpgrade(book)`.
- [ ] **Recording tests** in `booksService.test.ts`:
  - `enqueueCovers` with a new book and an id: the row has the id, and the book is enqueued `normal` once.
  - `enqueueCovers` on an existing `missing` book checked yesterday, with an id: enqueued `upgrade` only, not `normal`, and `cover_upgrade_wanted_at` set. The same for a `low_res` book checked yesterday.
  - `recordKoboImageIds` on a `missing` book checked 40 days ago (due): id stored, upgrade-wanted, enqueued `upgrade` only.
  - `recordKoboImageIds` on a book with no status: id stored, nothing enqueued.
  - `recordKoboImageIds` on a `good` Apple-cover book and on a `manual` book: id stored, nothing marked or enqueued.
  - `recordKoboImageIds` on a `good` book whose cover is ISBNdb's and whose ISBN starts `978972`: marked and enqueued `upgrade`.
  - `recordKoboImageIds` for a lookup with no catalog book: no row created (`findBookByKey` still empty).
  - A junk id (`file____mnt_onboard_x.epub`): nothing stored.
  - A second, different id: the first stays, nothing enqueued the second time.
- [ ] **Throttle.** In `plugin.ts`, add `KOBO_COVER_GAP_MS = 1000` beside the other gaps and a `createThrottle(KOBO_COVER_GAP_MS)` that `fetchImage` uses for `candidate.source === "kobo"`, the way it uses `openLibraryCoverThrottle` for `openlibrary`.
- [ ] **README**, `backend/README.md`'s `books` section:
  - the covers bullet (`:160`): a book with a Kobo image id (`books.kobo_image_id`, recorded from Kobo imports, first id wins) tries `cdn.kobo.com` first in every lane, as an exact match;
  - the worker bullet (`:161`): add Kobo at 1 s to the throttle list;
  - the lanes bullet (`:162`): every lane asks Kobo first when the book has an id, so "`upgrade` asks Apple only" becomes Kobo, then Apple;
  - the Apple stamp bullet (`:163`): "since that is its only source" no longer holds, and a Kobo cover of 400 px or more that ends a lookup before Apple is asked doesn't stamp;
  - the upgrade bullet (`:164`): the upgrade lookup replaces the cover when its find (Kobo's or Apple's) is wider, or by the watermark rule.
- [ ] Run `node scripts/gate.mjs` (see Baseline), then commit.

### Task 2: Backfill from imported libraries

**Files:**
- Modify: `backend/src/modules/library/workHolders.ts`
- Modify: `backend/src/modules/library/index.ts`
- Modify: `backend/src/modules/books/plugin.ts`
- Modify: `backend/src/app.ts`
- Modify: `backend/README.md`
- Modify: `docs/publisher-catalog.md`
- Test: `backend/src/modules/library/workHolders.test.ts`
- Test: `backend/src/booksWiring.test.ts`

- [ ] **Library read.** In `createWorkHolders` (`workHolders.ts`), add a prepared `SELECT DISTINCT isbn, title, author, image_id FROM library_books WHERE image_id IS NOT NULL` and `koboCoverLookups(): Array<{ isbn: string | null; title: string | null; author: string | null; imageId: string }>`, keeping only rows where `normalizeImageId(image_id)` is non-empty (returning the normalized id). Add the module-level `koboCoverLookups()` wrapper the same way `heldWorks()` has one (`workHolders.ts:79-82`), and export it from `library/index.ts`. Test in `workHolders.test.ts` with its existing setup: two users holding the same Kobo book give one lookup; a sideloaded path and a NULL `image_id` give none.
- [ ] **Books plugin job.** Add `koboCoverLookups?: () => BookLookup[]` to `BooksPluginOptions`. Add `koboCovers: 165_000` to `FIRST_RUN_DELAY_MS`. When the option is set, register `jobs.every("kobo covers", KOBO_COVERS_INTERVAL_MS, () => timeSync(app.log, "kobo-covers", () => service.recordKoboImageIds(koboCoverLookups())), FIRST_RUN_DELAY_MS.koboCovers)` with a local `KOBO_COVERS_INTERVAL_MS = 24 * 60 * 60 * 1000`.
- [ ] **Wiring.** In `app.ts`, import `koboCoverLookups` from the library index and pass it in `registerBooksModule`'s options next to `heldWorks`.
- [ ] **Boot test.** In `booksWiring.test.ts`'s "every books job arms its first run with its own delay…" test, add `koboCovers: 165_000` to `expected`, and add `cdn\.kobo\.com` to its URL pattern so a Kobo fetch before a first run fails the test.
- [ ] **Docs.**
  - `backend/README.md`: add the `kobo covers` job to the background-jobs description. It runs daily after its first-run delay and records ids from every library onto existing catalog books. It marks books that want a Kobo upgrade, so their covers are looked up on the upgrade lane, spending no ISBNdb or Open Library quota.
  - `docs/publisher-catalog.md`'s "Automatic sources" table: add a **Kobo** row. Used for covers of books imported from Kobo, keyed by `ImageId`, first in every lane, no key, 1 request/s. Note that what the CDN answers for an unknown id, and whether it upscales, are checked before merge (spec, "Verify before merge").
  - Fix the Apple row there, which says "upgrade lane, only source" and "Apple replaces them in the upgrade lane": Kobo comes first in that lane for books with an id.
- [ ] Run `node scripts/gate.mjs` (see Baseline), then commit.
